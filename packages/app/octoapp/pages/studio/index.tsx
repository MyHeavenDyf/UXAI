import "./studio.css"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { batch, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { authTokenFromCredentials } from "@/utils/server"
import { useServer } from "@/context/server"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import {
  STUDIO_ASPECT_RATIOS,
  STUDIO_CAPABILITIES,
  STUDIO_IMAGE_TOOLS,
  STUDIO_STYLE_MODELS,
  capabilityLabel,
  imageToolLabel,
  styleModelLabel,
} from "./data"
import type {
  StudioAsset,
  StudioAspectRatio,
  StudioCapability,
  StudioGenerationResult,
  StudioGenerationStatus,
  StudioImage,
  StudioMode,
  StudioImageTool,
} from "./types"
import {
  buildStudioDisplayPrompt,
  buildStudioTurns,
  type StudioTurnData,
} from "./turns"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])
const SUPPORTED_STUDIO_CAPABILITIES = new Set<StudioCapability>([
  "image.generate",
  "image.upscale",
  "image.cutout",
  "image.outpaint",
  "image.fusion",
])
const STUDIO_GENERATION_TIMEOUT_MS = 180_000

type DataStore = {
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

type StudioPendingResult = StudioGenerationResult & {
  sourceImage?: string
}

function formatStudioGenerationError(response: Response, bodyText: string) {
  const parsed = bodyText
    ? (() => {
        try {
          return JSON.parse(bodyText) as {
            data?: { message?: string }
            error?: string
            message?: string
            issues?: unknown
          }
        } catch {
          return undefined
        }
      })()
    : undefined
  const message =
    parsed?.data?.message ??
    parsed?.error ??
    parsed?.message ??
    (parsed?.issues ? JSON.stringify(parsed.issues) : undefined) ??
    bodyText.trim()
  return [
    `Studio generation failed: ${response.status} ${response.statusText}`.trim(),
    message,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")
}

function createBlobUrlFromDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) return url
  const mime = match[1]
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

function triggerBrowserDownload(url: string, filename: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export default function StudioPage() {
  const params = useParams<{ id?: string; dir?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const layout = useLayout()
  const server = useServer()

  const projectDir = useProjectDir({ mode: "config" })
  const [syncStore] = globalSync.child(projectDir(), { bootstrap: true })

  const isValidStudioSession = (sessionId: string | undefined): boolean => {
    if (!sessionId) return false
    const session = syncStore.session.find(s => s.id === sessionId)
    return session?.agent === "octo_studio"
  }

  const slug = createMemo(() => base64Encode(projectDir()))

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      ({ dir, id }) => {
        if (dir && id) {
          const decoded = decode64(dir)
          if (decoded) layout.lastSessionPerTab.setStudio(decoded, id)
        }
      },
    ),
  )

  const [prompt, setPrompt] = createSignal("")
  const [capability, setCapability] = createSignal<StudioCapability>("image.generate")
  const [styleModel, setStyleModel] = createSignal("qwen")
  const [aspectRatio, setAspectRatio] = createSignal<StudioAspectRatio>("3:4")
  const [count, setCount] = createSignal<1 | 2 | 3 | 4>(1)
  const [imageTool, setImageTool] = createSignal<StudioImageTool>("internel")
  const [assets, setAssets] = createSignal<StudioAsset[]>([])
  const [status, setStatus] = createSignal<StudioGenerationStatus>("idle")
  const [pendingResult, setPendingResult] = createSignal<StudioPendingResult>()
  const [selectedImageId, setSelectedImageId] = createSignal<string>()
  const [openMenu, setOpenMenu] = createSignal<"capability" | "imageTool" | "style" | "settings" | null>(null)
  const [mode, setMode] = createSignal<StudioMode>("preview")
  const [sending, setSending] = createSignal(false)
  const [studioLeftStore, setStudioLeftStore] = persisted(
    Persist.global("studio.left.width"),
    createStore({ width: 296 }),
  )
  const [studioCenterStore, setStudioCenterStore] = persisted(
    Persist.global("studio.center.width"),
    createStore({ width: 468 }),
  )
  const studioLeftWidth = () => studioLeftStore.width
  const setStudioLeftWidth = (w: number) => setStudioLeftStore({ width: w })
  const studioCenterWidth = () => studioCenterStore.width
  const setStudioCenterWidth = (w: number) => setStudioCenterStore({ width: w })
  const [dataStore, setDataStore] = createStore<DataStore>({
    session: [],
    session_status: {},
    message: {},
    part: {},
  })
  let fileInputRef!: HTMLInputElement
  let conversationScrollRef!: HTMLDivElement
  let scrollFrame = 0
  const blobUrlCache = new Map<string, string>()

  function displayUrl(url: string) {
    if (!url.startsWith("data:image/")) return url
    const cached = blobUrlCache.get(url)
    if (cached) return cached
    const next = createBlobUrlFromDataUrl(url)
    blobUrlCache.set(url, next)
    return next
  }

  function normalizeImage(image: StudioImage): StudioImage {
    const remoteUrl = image.remoteUrl ?? image.url
    const thumbnailSource = image.thumbnailUrl ?? image.url
    return {
      ...image,
      url: displayUrl(image.url),
      thumbnailUrl: displayUrl(thumbnailSource),
      remoteUrl,
    }
  }

  function normalizeResultValue(value?: StudioGenerationResult): StudioGenerationResult | undefined {
    if (!value) return
    return {
      ...value,
      images: value.images.map(normalizeImage),
    }
  }

  createEffect(() => {
    const active = new Set<string>()
    for (const turn of turns()) {
      for (const image of turn.result?.images ?? []) {
        if (image.url.startsWith("data:image/")) active.add(image.url)
        if (image.thumbnailUrl?.startsWith("data:image/")) active.add(image.thumbnailUrl)
        if (image.remoteUrl?.startsWith("data:image/")) active.add(image.remoteUrl)
      }
    }
    for (const image of pendingResult()?.images ?? []) {
      if (image.url.startsWith("data:image/")) active.add(image.url)
      if (image.thumbnailUrl?.startsWith("data:image/")) active.add(image.thumbnailUrl)
      if (image.remoteUrl?.startsWith("data:image/")) active.add(image.remoteUrl)
    }
    for (const [source, objectUrl] of blobUrlCache) {
      if (active.has(source)) continue
      URL.revokeObjectURL(objectUrl)
      blobUrlCache.delete(source)
    }
  })

  onCleanup(() => {
    cancelAnimationFrame(scrollFrame)
    for (const objectUrl of blobUrlCache.values()) {
      URL.revokeObjectURL(objectUrl)
    }
    blobUrlCache.clear()
  })

  function handleStudioLeftResize(event: MouseEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = studioLeftWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    function onMove(e: MouseEvent) {
      const delta = e.clientX - startX
      setStudioLeftWidth(Math.max(160, Math.min(360, startWidth + delta)))
    }
    function onUp() {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  function handleStudioCenterResize(event: MouseEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = studioCenterWidth()
    function onMove(e: MouseEvent) {
      const delta = e.clientX - startX
      setStudioCenterWidth(Math.min(700, Math.max(360, startWidth + delta)))
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  function loadSessionMessages(sessionID: string) {
    return globalSDK.client.session
      .get({ sessionID })
      .then((result) => {
        const session = result.data
        if (!session || session.agent !== "octo_studio") {
          batch(() => {
            setDataStore("message", {})
            setDataStore("part", {})
          })
          return
        }
        return globalSDK.client.session.messages({ sessionID }).then((msgResult) => {
          const items = msgResult.data ?? []
          const messages: Message[] = []
          const partMap: { [messageID: string]: Part[] } = {}
          for (const item of items as { info: Message; parts: Part[] }[]) {
            messages.push(item.info)
            partMap[item.info.id] = item.parts.filter((part) => !SKIP_PART_TYPES.has(part.type))
          }
          batch(() => {
            setDataStore("message", sessionID, reconcile(messages, { key: "id" }))
            for (const [messageID, parts] of Object.entries(partMap)) {
              setDataStore("part", messageID, reconcile(parts, { key: "id" }))
            }
          })
        })
      })
  }

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) {
          batch(() => {
            setDataStore("message", {})
            setDataStore("part", {})
          })
          return
        }
        loadSessionMessages(id)
          .catch((error) => console.error("[StudioPage] messages load failed", error))
      },
    ),
  )

  const unsub = globalSDK.event.listen((event) => {
    const sessionID = params.id
    if (!sessionID) return
    const payload = event.details

    if (payload.type === "message.updated") {
      const info = payload.properties.info
      if (info.sessionID !== sessionID) return
      const messages = dataStore.message[sessionID]
      if (!messages) {
        setDataStore("message", sessionID, [info])
        return
      }
      const result = Binary.search(messages, info.id, (message: Message) => message.id)
      if (result.found) {
        setDataStore("message", sessionID, result.index, reconcile(info))
        return
      }
      setDataStore("message", sessionID, produce((draft) => { draft.splice(result.index, 0, info) }))
      return
    }

    if (payload.type === "message.part.updated") {
      const part = payload.properties.part
      if (part.sessionID !== sessionID || SKIP_PART_TYPES.has(part.type)) return
      const parts = dataStore.part[part.messageID]
      if (!parts) {
        setDataStore("part", part.messageID, [part])
        return
      }
      const result = Binary.search(parts, part.id, (item: Part) => item.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
        return
      }
      setDataStore("part", part.messageID, produce((draft) => { draft.splice(result.index, 0, part) }))
      return
    }

    if (payload.type === "session.status") {
      const { sessionID: nextSessionID, status: nextStatus } = payload.properties
      if (nextSessionID !== sessionID) return
      setDataStore("session_status", nextSessionID, reconcile(nextStatus))
      return
    }

    const raw = payload as unknown as { type: string; properties: Record<string, unknown> }
    if (raw.type === "message.part.delta") {
      const props = raw.properties as { messageID: string; partID: string; field: string; delta: string }
      const parts = dataStore.part[props.messageID]
      if (!parts) return
      const result = Binary.search(parts, props.partID, (part: Part) => part.id)
      if (!result.found) return
      setDataStore("part", props.messageID, produce((draft) => {
        const part = draft[result.index] as Record<string, unknown>
        part[props.field] = `${part[props.field] ?? ""}${props.delta}`
      }))
    }
  })
  onCleanup(unsub)

  const sessionStatus = createMemo(() => {
    const id = params.id
    if (!id) return { type: "idle" } as SessionStatus
    return dataStore.session_status[id] ?? ({ type: "idle" } as SessionStatus)
  })

  const isBusy = createMemo(() => sending() || sessionStatus().type === "busy")
  const turns = createMemo(() =>
    buildStudioTurns({
      messages: params.id ? dataStore.message[params.id] ?? [] : [],
      parts: dataStore.part,
      fallback: pendingResult(),
    }),
  )
  const displayTurns = createMemo(() =>
    (() => {
      const pending = pendingResult()
      const pendingTurnID = pending ? `studio_${pending.id}` : undefined
      const next = turns().map((turn) => {
        const normalized = turn.result ? { ...turn, result: normalizeResultValue(turn.result) } : turn
        if (!pending || normalized.id !== pendingTurnID) return normalized
        return {
          ...normalized,
          assistantText: normalized.assistantText || buildStudioThinkingText({
            text: pending.prompt,
            capability: pending.capability,
            sourceImage: pending.sourceImage,
          }),
          toolTitle: pending.status === "failed" ? "图片生成失败" : pending.status === "succeeded" ? "图片生成完成" : "图片生成中",
          toolName: `${imageToolLabel(imageTool())} · ${pending.status === "failed" ? "失败" : pending.status === "succeeded" ? "完成" : "生成中"}`,
          toolRunning: pending.status === "running",
          result: normalizeResultValue(pending),
        }
      })
      if (!pending) return next
      if (!sending() && pending.status !== "failed" && next.length > 0) return next
      if ([pending.id, pendingTurnID].includes(next.at(-1)?.id)) return next
      return [
        ...next,
        {
          id: pending.id,
          userText: pending.prompt,
          assistantText: buildStudioThinkingText({
            text: pending.prompt,
            capability: pending.capability,
            sourceImage: pending.sourceImage,
          }),
          toolTitle: pending.status === "failed" ? "图片生成失败" : "图片生成中",
          toolName: `${imageToolLabel(imageTool())} · ${pending.status === "failed" ? "失败" : "生成中"}`,
          result: normalizeResultValue(pending),
          createdAt: pending.createdAt,
          isLatest: true,
        } satisfies StudioTurnData,
      ]
    })(),
  )
  const studioTurn = createMemo(() => turns().at(-1))
  const latestCompletedTurn = createMemo(() => [...turns()].reverse().find((turn) => (turn.result?.images.length ?? 0) > 0))
  const result = createMemo(() => normalizeResultValue(studioTurn()?.result ?? latestCompletedTurn()?.result ?? pendingResult()))
  const effectiveStatus = createMemo<StudioGenerationStatus>(() => {
    if (result()?.images.length) return "succeeded"
    if (status() === "failed" || result()?.status === "failed") return "failed"
    if (studioTurn()?.toolError) return "failed"
    if (studioTurn()?.assistantText && params.id) return "failed"
    if (status() === "succeeded") return "succeeded"
    if (isBusy()) return "running"
    return status()
  })

  const selectedImage = createMemo(() => {
    const images = result()?.images ?? []
    return images.find((item) => item.id === selectedImageId()) ?? images[0]
  })

  createEffect(() => {
    const first = result()?.images[0]?.id
    if (first && !result()?.images.some((image) => image.id === selectedImageId())) setSelectedImageId(first)
  })

  createEffect(() => {
    const pending = pendingResult()
    if (!pending) return
    if (studioTurn()?.id === pending.id) return
    if (studioTurn()?.userText !== pending.prompt) return
    if (!studioTurn()?.result && !studioTurn()?.toolError) return
    setPendingResult(undefined)
    setStatus(studioTurn()?.toolError ? "failed" : "succeeded")
  })

  createEffect(() => {
    const pending = pendingResult()
    if (!pending || sending()) return
    if (sessionStatus().type !== "idle") return
    if (studioTurn()?.id === pending.id) return
    if (studioTurn()?.userText !== pending.prompt) return
    if (studioTurn()?.result?.images.length) {
      setPendingResult(undefined)
      setStatus("succeeded")
      return
    }
    if (!studioTurn()?.toolError && !studioTurn()?.assistantText) return
    setPendingResult(undefined)
    setStatus("failed")
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id && !sending() && !pendingResult()) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        if (id && !sending()) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        setSelectedImageId(undefined)
        setMode("preview")
        setAssets([])
        setPrompt("")
      },
      { defer: true },
    ),
  )

  const selectedCapabilityNeedsImage = createMemo(() =>
    capability() === "image.upscale" || capability() === "image.cutout" || capability() === "image.outpaint",
  )
  const canSubmit = createMemo(() =>
    SUPPORTED_STUDIO_CAPABILITIES.has(capability()) &&
    !isBusy() &&
    (prompt().trim().length > 0 || (selectedCapabilityNeedsImage() && Boolean(selectedImage()))),
  )
  const currentTitle = createMemo(() =>
    latestCompletedTurn()?.result
      ? buildStudioDisplayPrompt(latestCompletedTurn()!.result!.prompt)
      : studioTurn()?.userText || "Octo Studio",
  )
  const currentImageLabel = createMemo(() => {
    const image = selectedImage()
    const images = result()?.images ?? []
    const index = image ? images.findIndex((item) => item.id === image.id) + 1 : 1
    const prefix = currentTitle() === "Octo Studio" ? "studio-image" : currentTitle().replace(/[\\/:*?\"<>|]/g, "-").slice(0, 24)
    return `${prefix}-${Math.max(index, 1)}.png`
  })

  async function downloadCurrentImage() {
    const image = selectedImage()
    if (!image) return
    const source = image.remoteUrl ?? image.url
    try {
      const response = await fetch(source)
      if (!response.ok) throw new Error(`Download request failed: ${response.status}`)
      const objectUrl = URL.createObjectURL(await response.blob())
      triggerBrowserDownload(objectUrl, currentImageLabel())
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      console.warn("[studio] image download fallback", error)
      triggerBrowserDownload(source, currentImageLabel())
    }
  }

  createEffect(
    on(
      () => `${params.id ?? ""}:${displayTurns().map((turn) => turn.id).join("|")}:${pendingResult()?.id ?? ""}`,
      () => {
        if (!params.id || !conversationScrollRef) return
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          conversationScrollRef.scrollTo({ top: conversationScrollRef.scrollHeight, behavior: "smooth" })
        })
      },
      { defer: true },
    ),
  )

  function addAssets(files: File[]) {
    const slots = 5 - assets().length
    files.slice(0, slots).map((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result
        if (typeof dataUrl !== "string") return
        setAssets((items) => [
          ...items,
          {
            id: crypto.randomUUID(),
            name: file.name,
            mime: file.type || "application/octet-stream",
            dataUrl,
          },
        ])
      }
      reader.readAsDataURL(file)
      return file.name
    })
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.files?.length) addAssets(Array.from(input.files))
    input.value = ""
  }

  async function createStudioSession(title?: string) {
    const dir = projectDir()
    if (!dir) return
    const result = await globalSDK.client.session.create({
      directory: dir,
      agent: "octo_studio",
      title: title ? buildStudioDisplayPrompt(title) : undefined,
    })
    const session = result.data as Session | undefined
    if (!session) return
    return session.id
  }

  function buildStudioThinkingText(input: { text: string; capability: StudioCapability; sourceImage?: string }) {
    const opening =
      input.capability === "image.upscale"
        ? "好的，我将提升当前图片的清晰度和细节。"
        : input.capability === "image.outpaint"
          ? `好的，我将扩展当前图片为${aspectRatio()}比例。`
          : `好的，我将为您生成一张${aspectRatio()}比例的${capabilityLabel(input.capability)}。`
    return [
      opening,
      `风格模型：${styleModelLabel(styleModel())}`,
      `画幅比例：${aspectRatio()}`,
      `生成数量：${count()}`,
      `当前选中的生图工具：${imageToolLabel(imageTool())}`,
      input.sourceImage && imageTool() === "internel"
        ? "将延续上一轮画面设定重新生成。"
        : input.sourceImage
          ? "这是基于上一张图片继续编辑。"
          : undefined,
      `用户需求：${input.text}`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n")
  }

  async function createStudioGeneration(input: {
    sessionID: string
    text: string
    capability: StudioCapability
    sourceImage?: string
    extra?: Record<string, unknown>
  }) {
    const current = server.current
    if (!current) throw new Error("No active server.")
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-opencode-directory": projectDir(),
    }
    if (current.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), STUDIO_GENERATION_TIMEOUT_MS)
    const response = await fetch(new URL("/studio/generations", current.http.url), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        sessionID: input.sessionID,
        capability: input.capability,
        prompt: input.text,
        styleModel: styleModelLabel(styleModel()),
        aspectRatio: aspectRatio(),
        count: count(),
        imageTool: "internel",
        referenceImages: assets().map((item) => item.dataUrl),
        sourceImage: input.sourceImage,
        extra: input.extra,
      }),
    }).finally(() => clearTimeout(timeout))
    const bodyText = await response.text()
    if (!response.ok) {
      throw new Error(formatStudioGenerationError(response, bodyText))
    }
    return JSON.parse(bodyText) as StudioGenerationResult
  }

  async function runGeneration(overrides?: { capability?: StudioCapability; sourceImage?: string; prompt?: string; extra?: Record<string, unknown> }) {
    const nextCapability = overrides?.capability ?? capability()
    const text = (overrides?.prompt ?? prompt()).trim() || (
      nextCapability === "image.upscale"
        ? "将当前图片变清晰，提升分辨率和细节"
        : nextCapability === "image.cutout"
          ? "对当前图片进行抠图，移除背景并保留主体"
          : nextCapability === "image.outpaint"
            ? "保留主体和画面风格，扩展更大尺寸和更多环境内容"
            : ""
    )
    if (!text || isBusy()) return
    const previousPrompt = prompt()
    setOpenMenu(null)
    setMode("preview")
    setSending(true)
    setStatus("submitting")
    setPendingResult({
      id: `studio_pending_${Date.now()}`,
      status: "running",
      capability: nextCapability,
      prompt: text,
      provider: nextCapability === "image.generate" ? imageTool() : "internel",
      model: styleModelLabel(styleModel()),
      aspectRatio: aspectRatio(),
      images: [],
      createdAt: Date.now(),
      sourceImage: overrides?.sourceImage,
    })
    setPrompt("")
    try {
      const existingSession = isValidStudioSession(params.id)
      const sessionID = existingSession ? params.id! : await createStudioSession(text)
      if (!sessionID) throw new Error("Unable to create Studio session.")
      const generation = await createStudioGeneration({
        sessionID,
        text,
        capability: nextCapability,
        sourceImage: overrides?.sourceImage,
        extra: overrides?.extra,
      })
      setPendingResult({
        ...generation,
        sourceImage: overrides?.sourceImage,
      })
      if (!existingSession) navigate(`/${slug()}/studio/${sessionID}`)
      await loadSessionMessages(sessionID)
      setStatus("succeeded")
      setAssets([])
    } catch (error) {
      console.error("[StudioPage] studio prompt failed", error)
      setPrompt(previousPrompt)
      setStatus("failed")
      setPendingResult((item) => item ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) } : item)
    } finally {
      setSending(false)
    }
  }

  function handleSubmit() {
    if (!SUPPORTED_STUDIO_CAPABILITIES.has(capability())) return
    if (capability() === "image.upscale" || capability() === "image.cutout" || capability() === "image.outpaint") {
      const image = selectedImage()
      if (!image) return
      void runGeneration({
        capability: capability(),
        sourceImage: image.remoteUrl ?? image.url,
      })
      return
    }
    void runGeneration()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    handleSubmit()
  }

  function openOutpaint() {
    if (!selectedImage()) return
    setMode("outpaint")
  }

  function submitOutpaint(input: { prompt: string; extra: Record<string, unknown> }) {
    const image = selectedImage()
    if (!image) return
    void runGeneration({
      capability: "image.outpaint",
      sourceImage: image.remoteUrl ?? image.url,
      prompt: input.prompt || "保留主体和画面风格，扩展更大尺寸和更多环境内容",
      extra: input.extra,
    })
  }

  function upscaleCurrentImage() {
    const image = selectedImage()
    if (!image || isBusy()) return
    void runGeneration({
      capability: "image.upscale",
      sourceImage: image.remoteUrl ?? image.url,
      prompt: "将当前图片变清晰，提升分辨率和细节",
    })
  }

  function cutoutCurrentImage() {
    const image = selectedImage()
    if (!image || isBusy()) return
    void runGeneration({
      capability: "image.cutout",
      sourceImage: image.remoteUrl ?? image.url,
      prompt: "对当前图片进行抠图，移除背景并保留主体",
    })
  }

  function regenerateCurrentResult() {
    const current = result()
    if (!current) return
    void runGeneration({
      capability: current.capability,
      prompt: current.prompt,
    })
  }

  const hasStudioConversation = createMemo(() => turns().length > 0 || Boolean(pendingResult()) || sending())

  const [hintVisible, setHintVisible] = createSignal(false)

  createEffect(() => {
    if (params.id || prompt().trim() || !new URLSearchParams(location.search).has("hint")) {
      setHintVisible(false)
      return
    }
    setHintVisible(true)
    const timer = setTimeout(() => setHintVisible(false), 3000)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <div class="studio-page" style={{ position: "relative" }}>
      <aside class="studio-left" style={{ width: `${studioLeftWidth()}px`, "flex-basis": `${studioLeftWidth()}px` }}>
        <StudioHistory directory={projectDir()} activeSessionID={params.id} onNewConversation={() => navigate(`/${slug()}/studio?hint=${Date.now()}`)} />
      </aside>
      <div
        style={{
          position: "absolute",
          top: "0",
          bottom: "0",
          left: `${studioLeftWidth() - 4}px`,
          width: "8px",
          cursor: "col-resize",
          "z-index": "10",
        }}
        onMouseDown={handleStudioLeftResize}
      />

      <Show when={hasStudioConversation()} fallback={
        <main class="studio-empty-workspace">
          <div class="studio-empty-stack">
            <div class="studio-empty-group">
              <StudioIntro />
              <div class="relative size-full">
                <Show when={hintVisible()}>
                  <div class="absolute -top-10 left-1/2 -translate-x-1/2 z-50 pointer-events-none whitespace-nowrap" data-component="tooltip">
                    {language.t("prompt.hint.newSession")}
                  </div>
                </Show>
                <StudioComposer
                  prompt={prompt()}
                capability={capability()}
                imageTool={imageTool()}
                styleModel={styleModel()}
                aspectRatio={aspectRatio()}
                count={count()}
                assets={assets()}
                status={effectiveStatus()}
                openMenu={openMenu()}
                canSubmit={canSubmit()}
                onPrompt={setPrompt}
                onCapability={setCapability}
                onImageTool={setImageTool}
                onStyleModel={setStyleModel}
                onAspectRatio={setAspectRatio}
                onCount={setCount}
                onOpenMenu={setOpenMenu}
                onSubmit={handleSubmit}
                onKeyDown={handleKeyDown}
                onPickFile={() => fileInputRef.click()}
                onRemoveAsset={(id) => setAssets((items) => items.filter((item) => item.id !== id))}
              />
            </div>
          </div>
        </div>
        </main>
      }>
        <section class="studio-center" style={{ width: `${studioCenterWidth()}px`, flex: `0 0 ${studioCenterWidth()}px` }}>
          <div class="studio-center-header">
            <div class="studio-center-title">{currentTitle()}</div>
            <div class="studio-center-path" title={projectDir()}>
              {projectDir()}
            </div>
          </div>

          <ScrollView
            viewportRef={(el) => { conversationScrollRef = el }}
            class="studio-center-scroll"
          >
            <Show when={turns().length > 0 || pendingResult() || sending()} fallback={<StudioIntro />}>
              <StudioConversation
                result={result()}
                turns={displayTurns()}
                busy={effectiveStatus() === "running" || effectiveStatus() === "submitting"}
                onSelectImage={setSelectedImageId}
              />
            </Show>
          </ScrollView>

          <StudioComposer
            prompt={prompt()}
            capability={capability()}
            imageTool={imageTool()}
            styleModel={styleModel()}
            aspectRatio={aspectRatio()}
            count={count()}
            assets={assets()}
            status={effectiveStatus()}
            openMenu={openMenu()}
            canSubmit={canSubmit()}
            onPrompt={setPrompt}
            onCapability={setCapability}
            onImageTool={setImageTool}
            onStyleModel={setStyleModel}
            onAspectRatio={setAspectRatio}
            onCount={setCount}
            onOpenMenu={setOpenMenu}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            onPickFile={() => fileInputRef.click()}
            onRemoveAsset={(id) => setAssets((items) => items.filter((item) => item.id !== id))}
          />
        </section>
        <div
          class="absolute top-0 bottom-0 cursor-col-resize z-10"
          style={{ left: `${studioLeftWidth() + studioCenterWidth() - 4}px`, width: "8px" }}
          onMouseDown={handleStudioCenterResize}
        />

      <main class="studio-workspace">
        <section class="studio-canvas">
          <Show when={mode() === "outpaint" && selectedImage()} fallback={
            <StudioResultCanvas
              status={effectiveStatus()}
              image={selectedImage()}
              result={result()}
              imageLabel={currentImageLabel()}
              regenerateDisabled={isBusy()}
              onRegenerate={regenerateCurrentResult}
              onDownload={() => void downloadCurrentImage()}
            />
          }>
            {(image) => (
              <StudioOutpaintEditor
                image={image()}
                aspectRatio={aspectRatio()}
                onAspectRatio={setAspectRatio}
                onClose={() => setMode("preview")}
                onSubmit={submitOutpaint}
              />
            )}
          </Show>
        </section>

          <Show when={result()?.images.length}>
            <aside class="studio-details">
              <StudioDetails
                result={result()!}
                image={selectedImage()}
                selectedImageId={selectedImageId()}
                imageLabel={currentImageLabel()}
                regenerateDisabled={isBusy()}
                onSelectImage={setSelectedImageId}
                onRegenerate={regenerateCurrentResult}
                onUpscale={upscaleCurrentImage}
                onCutout={cutoutCurrentImage}
                onOutpaint={openOutpaint}
              />
            </aside>
          </Show>
        </main>
      </Show>
      <input ref={fileInputRef!} type="file" multiple accept="image/*" class="hidden" onChange={handleFileChange} />
    </div>
  )
}

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none"
      style={{
        transform: props.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgba(0,0,0,0.6)"/>
    </svg>
  )
}

function StudioHistory(props: { directory: string; activeSessionID?: string; onNewConversation: () => void }): JSX.Element {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const dialog = useDialog()

  const [sessions, { refetch }] = createResource(
    () => ({ dir: props.directory ?? "", id: props.activeSessionID }),
    async (source) => {
      const d = source.dir
      if (!d) return [] as Session[]
      const client = globalSDK.createClient({ directory: d })
      const result = await client.session.list()
      const data = ((result.data ?? []) as Session[])
        .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      return data.filter(s => s.agent === "octo_studio" && !s.time?.archived)
    },
  )
  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 1000)
    }
  })
  onCleanup(unsub)
  onCleanup(() => { clearTimeout(refetchTimer) })

  const isLoading = createMemo(() => sessions.loading)
  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <div
      class="h-full flex flex-col"
      style={{
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        padding: "12px 12px 24px 12px",
      }}
    >
      <div class="flex-1 min-h-0 flex flex-col">
        {/* New session button + divider */}
        <div class="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            class="flex items-center gap-3 w-full rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
            style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
            onClick={props.onNewConversation}
          >
            <Icon name="plus" size="normal" class="shrink-0" />
            <span>{language.t("command.session.new")}</span>
          </button>
          <div style={{ height: "1px", background: "rgba(0,0,0,0.1)" }} />
        </div>

        {/* Collapsible section header */}
        <div class="flex items-center h-[36px] px-[12px] mt-[8px]">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
          >
            <span class="flex items-center gap-[12px]">
              <img src="/studio/IconStudio1.svg" alt="" style={{ width: "20px", height: "20px" }} />
              <span class="text-[12px] leading-[20px] select-none" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                Octo Studio
              </span>
            </span>
            <ChevronRightIcon collapsed={collapsed()} />
          </button>
        </div>

        {/* Session list */}
        <Show when={!collapsed()}>
        <div class="flex flex-col flex-1 min-h-0">
          <div data-slot="list-scroll" class="flex-1 min-h-0 overflow-y-auto" style={{ "margin-right": "-12px", "padding-right": "12px"}}>
            <Show when={!isLoading()} fallback={
              <div class="text-12-regular text-text-weak py-4 text-center">
                <Spinner class="size-4 mx-auto mb-1" />
                {language.t("common.loading")}
              </div>
            }>
              <Show
                when={sessionList.length > 0}
                fallback={
                  <div class="text-12-regular text-text-weak py-4 text-center">
                    {language.t("sidebar.history.empty")}
                  </div>
                }
              >
                <div class="flex flex-col">
                  <For each={sessionList}>
                    {(session) => {
                      const isActive = () => props.activeSessionID === session.id
                      return (
                        <div class="group/item relative">
                          <a
                            href={`/${base64Encode(props.directory)}/studio/${session.id}`}
                            class="flex items-center w-full rounded-[8px] transition-colors"
                            style={{ height: "36px", padding: "0 24px 0 44px", "font-size": "12px", "line-height": "20px", color: isActive() ? "#0A59F7" : undefined }}
                            classList={{
                              "bg-[rgba(10,89,247,0.08)]": isActive(),
                              "hover:bg-surface-base-hover": !isActive(),
                            }}
                          >
                            <span class="flex-1 min-w-0 truncate">
                              {sessionTitle(session.title) ?? language.t("command.session.new")}
                            </span>
                          </a>
                          <Show when={isActive()}>
                            <span
                              class="absolute rounded-full pointer-events-none"
                              style={{
                                right: "8px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                width: "4px",
                                height: "28px",
                                background: "#0A59F7",
                              }}
                            />
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
        </Show>
      </div>

      <button
        type="button"
        class="flex items-center gap-3 w-full rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
        style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
        onClick={() => dialog.show(() => <DialogSettings />)}
      >
        <Icon name="settings-gear" size="small" class="shrink-0" />
        <span class="text-[14px] leading-[22px]">{language.t("sidebar.settings")}</span>
      </button>
    </div>
  )
}

function StudioIntro(): JSX.Element {
  return (
    <div class="studio-intro">
      <img src={IconHost} width={120} height={120} alt="" style={{ "flex-shrink": "0" }} />
      <div class="studio-intro-copy">
        <div class="studio-intro-title">Octo Studio</div>
        <div class="studio-intro-subtitle">有任何想法您都可以通过下方输入框输入</div>
      </div>
    </div>
  )
}

function StudioComposer(props: {
  prompt: string
  capability: StudioCapability
  imageTool: StudioImageTool
  styleModel: string
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  assets: StudioAsset[]
  status: StudioGenerationStatus
  openMenu: "capability" | "imageTool" | "style" | "settings" | null
  canSubmit: boolean
  onPrompt: (value: string) => void
  onCapability: (value: StudioCapability) => void
  onImageTool: (value: StudioImageTool) => void
  onStyleModel: (value: string) => void
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onOpenMenu: (value: "capability" | "imageTool" | "style" | "settings" | null) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onPickFile: () => void
  onRemoveAsset: (id: string) => void
}): JSX.Element {
  let composerRef!: HTMLDivElement

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!props.openMenu || composerRef.contains(event.target as Node)) return
    props.onOpenMenu(null)
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown)
  onCleanup(() => document.removeEventListener("pointerdown", handleDocumentPointerDown))

  return (
    <div ref={composerRef!} class="studio-composer-wrap relative shrink-0">
      <Show when={props.openMenu === "capability"}>
        <CapabilityMenu value={props.capability} onSelect={(value) => { props.onCapability(value); props.onOpenMenu(null) }} />
      </Show>
      <Show when={props.openMenu === "imageTool"}>
        <ImageToolMenu value={props.imageTool} onSelect={(value) => { props.onImageTool(value); props.onOpenMenu(null) }} />
      </Show>
      <Show when={props.openMenu === "style"}>
        <StyleMenu value={props.styleModel} onSelect={(value) => { props.onStyleModel(value); props.onOpenMenu(null) }} />
      </Show>
      <Show when={props.openMenu === "settings"}>
        <ImageSettings
          aspectRatio={props.aspectRatio}
          count={props.count}
          onAspectRatio={props.onAspectRatio}
          onCount={props.onCount}
        />
      </Show>

      <div class="studio-composer">
        <div class="studio-composer-input-row">
          <button
            type="button"
            onClick={props.onPickFile}
            class="studio-composer-ref-btn"
            title="上传参考图"
          />
          <textarea
            value={props.prompt}
            onInput={(event) => props.onPrompt(event.currentTarget.value)}
            onKeyDown={props.onKeyDown}
            placeholder="上传参考图、输入文字，描述你想生成的图片。"
            class="studio-composer-input"
            disabled={props.status === "running" || props.status === "submitting"}
          />
        </div>

        <Show when={props.assets.length > 0}>
          <div class="flex gap-2 mt-3 overflow-x-auto">
            <For each={props.assets}>
              {(item) => (
                <button
                  type="button"
                  onClick={() => props.onRemoveAsset(item.id)}
                  class="relative w-[46px] h-[46px] shrink-0 overflow-hidden rounded-[8px] border border-[rgba(15,23,42,0.08)]"
                  title={`${item.name}，点击移除`}
                >
                  <img src={item.dataUrl} class="w-full h-full object-cover" alt="" />
                  <span class="absolute right-0 top-0 w-4 h-4 rounded-bl-[8px] bg-black/50 text-white text-[10px]">×</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="studio-composer-toolbar">
          <ToolButton label={capabilityLabel(props.capability)} onClick={() => props.onOpenMenu(props.openMenu === "capability" ? null : "capability")} />
          <ToolButton label={imageToolLabel(props.imageTool)} onClick={() => props.onOpenMenu(props.openMenu === "imageTool" ? null : "imageTool")} />
          <ToolButton label={styleModelLabel(props.styleModel)} onClick={() => props.onOpenMenu(props.openMenu === "style" ? null : "style")} />
          <IconTool label="参数" onClick={() => props.onOpenMenu(props.openMenu === "settings" ? null : "settings")} />
          <IconTool label="素材" onClick={props.onPickFile} />
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={!props.canSubmit}
            class="studio-composer-send"
            title="生成"
          />
        </div>
      </div>
    </div>
  )
}

function ToolButton(props: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={props.onClick} class="studio-composer-tool-btn">
      <span class="studio-composer-tool-label">{props.label}</span>
      <span class="studio-composer-tool-caret" />
    </button>
  )
}

function IconTool(props: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`studio-composer-icon-tool ${props.label === "参数" ? "studio-composer-icon-settings" : "studio-composer-icon-material"}`}
      title={props.label}
      aria-label={props.label}
    />
  )
}

function CapabilityMenu(props: { value: StudioCapability; onSelect: (value: StudioCapability) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[175px] p-1">
      <For each={STUDIO_CAPABILITIES}>
        {(item, index) => (
          <>
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              disabled={!SUPPORTED_STUDIO_CAPABILITIES.has(item.id)}
              class="studio-capability-option"
              classList={{
                active: item.id === props.value,
                "opacity-45 cursor-not-allowed": !SUPPORTED_STUDIO_CAPABILITIES.has(item.id),
              }}
              title={SUPPORTED_STUDIO_CAPABILITIES.has(item.id) ? item.description : "即将支持"}
            >
              <span class={`studio-capability-icon studio-capability-icon-${index() + 1}`} />
              <span class="studio-capability-label">{item.label}</span>
            </button>
            <Show when={index() === 1 || index() === 5}>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 12px" }} />
            </Show>
          </>
        )}
      </For>
    </div>
  )
}

function StyleMenu(props: { value: string; onSelect: (value: string) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[414px] p-4 left-[118px]">
      <div class="text-[13px] font-semibold mb-3">风格模型</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <For each={STUDIO_STYLE_MODELS}>
          {(item, index) => (
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              class="studio-style-option"
              classList={{ active: item.id === props.value }}
            >
              <span class={`studio-style-icon studio-style-icon-${index() + 1}`} />
              <span class="studio-style-label">{item.label}</span>
              <Show when={item.id === props.value}>
                <span class="studio-style-check" />
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function ImageToolMenu(props: { value: StudioImageTool; onSelect: (value: StudioImageTool) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[280px] p-4 left-[118px]">
      <div class="text-[13px] font-semibold mb-3">生图工具</div>
      <div class="flex flex-col gap-2">
        <For each={STUDIO_IMAGE_TOOLS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onSelect(item.id)}
              class="w-full rounded-[8px] px-3 py-2 text-left hover:bg-[#f4f5f7]"
              classList={{ "bg-[#f0f1f3]": item.id === props.value }}
            >
              <div class="text-[13px] font-medium">{item.label}</div>
              <div class="text-[11px] text-[var(--studio-muted)] mt-1">{item.description}</div>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function ImageSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
}): JSX.Element {
  return (
    <div class="studio-menu w-[420px] p-4 left-[16px]">
      <div class="text-[13px] font-semibold mb-5">图片设置</div>
      <div class="text-[12px] text-[var(--studio-muted)] mb-2">选择比例</div>
      <div class="grid grid-cols-7 gap-1 bg-[#f1f1f2] rounded-[8px] p-1 mb-5">
        <For each={STUDIO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="h-[54px] rounded-[7px] text-[12px] flex flex-col items-center justify-center gap-1 border transition-colors"
              classList={{
                "border-[#1267ff] bg-[#eef5ff] text-[#1267ff] shadow-sm font-semibold": item === props.aspectRatio,
                "border-transparent hover:bg-white/70": item !== props.aspectRatio,
              }}
              aria-pressed={item === props.aspectRatio}
            >
              <span class="w-4 h-5 border border-current rounded-[2px]" />
              <span>{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="text-[12px] text-[var(--studio-muted)] mb-2">图片数量</div>
      <div class="grid grid-cols-4 gap-1 bg-[#f1f1f2] rounded-[8px] p-1">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="h-8 rounded-[7px] text-[13px] border transition-colors"
              classList={{
                "border-[#1267ff] bg-[#eef5ff] text-[#1267ff] shadow-sm font-semibold": item === props.count,
                "border-transparent hover:bg-white/70": item !== props.count,
              }}
              aria-pressed={item === props.count}
            >
              {item}张
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function StudioConversation(props: {
  result?: StudioGenerationResult
  turns: StudioTurnData[]
  busy: boolean
  onSelectImage: (id: string) => void
}): JSX.Element {
  return (
    <div class="studio-conversation">
      <For each={props.turns}>
        {(turn, index) => (
          <div class="studio-conversation-turn" classList={{ separated: index() > 0 }}>
            <div class="studio-user-bubble">
              {turn.userText || props.result?.prompt?.split("\n")[0] || "Octo Studio"}
            </div>
            <Show when={turn.assistantText}>
              <div class="studio-assistant-copy">{turn.assistantText}</div>
            </Show>
            <div
              class="studio-result-card"
              classList={{
                complete: Boolean(turn.result?.images.length),
                generating: Boolean((props.busy || turn.toolRunning || turn.result?.status === "running") && turn.isLatest && !turn.result?.images.length),
                failed: Boolean(turn.toolError || turn.result?.error),
              }}
            >
              <div class="studio-result-badge">
                <span class="studio-result-badge-icon" />
                {capabilityLabel(turn.result?.capability ?? props.result?.capability ?? "image.generate")}
              </div>
              <div class="studio-result-title">{turn.toolTitle ?? (turn.result?.images.length ? "图片生成完成" : "图片生成中")}</div>
              <div class="studio-result-meta">
                {turn.toolName ? `Tool：${turn.toolName} · ` : ""}
                创建时间：{formatTime(turn.createdAt)}
              </div>
              <Show when={turn.toolError}>
                <div class="studio-result-error">
                  {turn.toolError}
                </div>
              </Show>
              <Show when={turn.result?.error}>
                <div class="studio-result-error">
                  {turn.result?.error}
                </div>
              </Show>
              <Show when={(props.busy || turn.toolRunning || turn.result?.status === "running") && turn.isLatest && !turn.result?.images.length} fallback={
                <div class="studio-result-grid">
                  <For each={turn.result?.images ?? []}>
                    {(image) => (
                      <button type="button" onClick={() => props.onSelectImage(image.id)} class="studio-result-thumb">
                        <img src={image.thumbnailUrl ?? image.url} alt="" />
                      </button>
                    )}
                  </For>
                </div>
              }>
                <div class="studio-generation-skeleton">
                  <div class="studio-generation-skeleton-shine" />
                  <div class="studio-generation-skeleton-image" />
                </div>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function StudioResultCanvas(props: {
  status: StudioGenerationStatus
  image?: StudioImage
  result?: StudioGenerationResult
  imageLabel: string
  regenerateDisabled: boolean
  onRegenerate: () => void
  onDownload: () => void
}): JSX.Element {
  return (
    <Show when={props.image} fallback={
      <div class="h-full flex flex-col items-center justify-center text-center">
        <Show when={props.status === "running" || props.status === "submitting"} fallback={
          <Show when={props.status === "failed" && props.result?.error} fallback={
          <>
            <StudioGlassSphere />
            <div class="mt-8 text-[28px] font-bold">Octo Studio</div>
            <div class="mt-2 text-[15px] text-[var(--studio-muted)]">输入你的想法，创意无限可能</div>
          </>
          }>
            <div class="max-w-[520px] rounded-[16px] border border-[rgba(180,35,24,0.16)] bg-[rgba(255,244,242,0.92)] px-5 py-4 text-left shadow-sm">
              <div class="text-[16px] font-semibold text-[#b42318]">生成失败</div>
              <div class="mt-2 text-[12px] leading-[18px] whitespace-pre-wrap break-all text-[#7a271a]">
                {props.result?.error}
              </div>
            </div>
          </Show>
        }>
          <div class="flex items-end gap-4 mb-8">
            <span class="studio-loader-dot bg-[#2e9dfb]" />
            <span class="studio-loader-dot bg-[#45bcc9]" style={{ "animation-delay": "120ms" }} />
            <span class="studio-loader-dot bg-[#704cff]" style={{ "animation-delay": "240ms" }} />
            <span class="studio-loader-dot bg-[#d100d8]" style={{ "animation-delay": "360ms" }} />
          </div>
          <div class="text-[14px] font-medium">生成中...</div>
        </Show>
      </div>
    }>
      {(image) => (
        <>
          <div class="studio-canvas-header">
            <span class="studio-canvas-label">{props.imageLabel}</span>
          </div>
          <div class="studio-canvas-stage">
            <img src={image().url} class="studio-canvas-image" alt="Studio generated result" />
          </div>
          <div class="studio-canvas-floating-actions">
            <div class="studio-canvas-actions-group">
              <button type="button" class="studio-canvas-favorite-button" title="收藏" aria-label="收藏" />
            </div>
            <div class="studio-canvas-actions-divider" />
            <button
              type="button"
              class="studio-canvas-regenerate-button disabled:opacity-45 disabled:cursor-not-allowed"
              onClick={props.onRegenerate}
              disabled={props.regenerateDisabled}
              title="再次生成"
              aria-label="再次生成"
            />
            <button type="button" onClick={props.onDownload} class="studio-canvas-download-action" title="下载">下载</button>
          </div>
        </>
      )}
    </Show>
  )
}

function StudioDetails(props: {
  result: StudioGenerationResult
  image?: StudioImage
  selectedImageId?: string
  imageLabel: string
  regenerateDisabled: boolean
  onSelectImage: (id: string) => void
  onRegenerate: () => void
  onUpscale: () => void
  onCutout: () => void
  onOutpaint: () => void
}): JSX.Element {
  return (
    <ScrollView class="studio-detail-panel">
      <div class="studio-detail-cover">
        <For each={props.result.images}>
          {(image) => (
            <button
              type="button"
              onClick={() => props.onSelectImage(image.id)}
              class="studio-detail-preview-button"
              classList={{ active: image.id === (props.selectedImageId ?? props.result.images[0]?.id) }}
            >
              <img src={image.thumbnailUrl ?? image.url} class="studio-detail-preview-image" alt="" />
            </button>
          )}
        </For>
      </div>
      <section class="studio-detail-section">
        <div class="studio-detail-title">{buildStudioDisplayPrompt(props.result.prompt)}</div>
        <p class="studio-detail-copy">
          {props.result.prompt}
        </p>
      </section>
      <section class="studio-detail-section">
        <div class="studio-detail-section-title">生成信息</div>
        <InfoRow label="模型" value={props.result.model} />
        <InfoRow label="比例" value={props.result.aspectRatio} />
        <InfoRow label="分辨率" value={props.image?.width && props.image.height ? `${props.image.width} x ${props.image.height}` : "-"} />
        <InfoRow label="数量" value={`${props.result.images.length}`} />
        <InfoRow label="当前" value={`${Math.max(props.result.images.findIndex((item) => item.id === (props.selectedImageId ?? props.result.images[0]?.id)) + 1, 1)}/${props.result.images.length}`} />
      </section>
      <section class="studio-detail-section">
        <div class="studio-detail-section-title">提示词</div>
        <p class="studio-detail-prompt">{props.result.prompt.split("\n")[0]}</p>
        <button
          type="button"
          onClick={props.onRegenerate}
          disabled={props.regenerateDisabled}
          class="studio-details-primary-action disabled:opacity-45 disabled:cursor-not-allowed"
        >
          再次生成
        </button>
        <div class="studio-detail-action-grid">
          <button
            type="button"
            onClick={props.onUpscale}
            disabled={props.regenerateDisabled}
            class="studio-details-secondary-action studio-detail-action-upscale disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <span>变清晰</span>
          </button>
          <button
            type="button"
            onClick={props.onCutout}
            disabled={props.regenerateDisabled}
            class="studio-details-secondary-action studio-detail-action-cutout disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <span>抠图</span>
          </button>
          <button type="button" class="studio-details-secondary-action studio-detail-action-inpaint">
            <span>局部重绘</span>
          </button>
          <button
            type="button"
            onClick={props.onOutpaint}
            disabled={props.regenerateDisabled}
            class="studio-details-secondary-action studio-detail-action-outpaint disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <span>扩图</span>
          </button>
        </div>
      </section>
      <section class="studio-detail-section">
        <div class="studio-detail-section-title">风格标签</div>
        <div class="studio-detail-tags">
          <For each={[capabilityLabel(props.result.capability), props.result.model, props.result.aspectRatio, `${props.result.images.length}张`, `${props.result.images.length}张结果`]}>
            {(item) => <span>{item}</span>}
          </For>
        </div>
      </section>
    </ScrollView>
  )
}

type OutpaintBox = {
  x: number
  y: number
  width: number
  height: number
}

type OutpaintHandle = "top-left" | "top" | "top-right" | "left" | "right" | "bottom-left" | "bottom" | "bottom-right"

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function ratioBox(imageBox: OutpaintBox, stage: { width: number; height: number }, ratio: StudioAspectRatio): OutpaintBox {
  const ratioValue =
    ratio === "16:9"
      ? 16 / 9
      : ratio === "9:16"
        ? 9 / 16
        : 1
  const imageRatio = imageBox.width / imageBox.height
  const width = ratioValue > imageRatio ? imageBox.height * ratioValue : imageBox.width
  const height = ratioValue > imageRatio ? imageBox.height : imageBox.width / ratioValue
  return {
    x: clamp(imageBox.x + (imageBox.width - width) / 2, 0, stage.width - width),
    y: clamp(imageBox.y + (imageBox.height - height) / 2, 0, stage.height - height),
    width,
    height,
  }
}

function resizeOutpaintBox(input: {
  rect: OutpaintBox
  imageBox: OutpaintBox
  stage: { width: number; height: number }
  handle: OutpaintHandle
  dx: number
  dy: number
}): OutpaintBox {
  const next = { ...input.rect }
  const imageRight = input.imageBox.x + input.imageBox.width
  const imageBottom = input.imageBox.y + input.imageBox.height
  if (input.handle.includes("left")) {
    next.x = clamp(input.rect.x + input.dx, 0, input.imageBox.x)
    next.width = input.rect.x + input.rect.width - next.x
  }
  if (input.handle.includes("right")) {
    next.width = clamp(input.rect.x + input.rect.width + input.dx, imageRight, input.stage.width) - next.x
  }
  if (input.handle.includes("top")) {
    next.y = clamp(input.rect.y + input.dy, 0, input.imageBox.y)
    next.height = input.rect.y + input.rect.height - next.y
  }
  if (input.handle.includes("bottom")) {
    next.height = clamp(input.rect.y + input.rect.height + input.dy, imageBottom, input.stage.height) - next.y
  }
  return {
    x: next.x,
    y: next.y,
    width: Math.max(input.imageBox.width, next.width),
    height: Math.max(input.imageBox.height, next.height),
  }
}

function StudioOutpaintEditor(props: {
  image: StudioImage
  aspectRatio: StudioAspectRatio
  onAspectRatio: (value: StudioAspectRatio) => void
  onClose: () => void
  onSubmit: (input: { prompt: string; extra: Record<string, unknown> }) => void
}): JSX.Element {
  const [editorPrompt, setEditorPrompt] = createSignal("")
  const [stage, setStage] = createSignal({ width: 828, height: 420 })
  const [rect, setRect] = createSignal<OutpaintBox>()
  const ratios = ["1:1", "9:16", "16:9"] as StudioAspectRatio[]
  let stageRef!: HTMLDivElement

  const imageBox = createMemo<OutpaintBox>(() => {
    const sourceWidth = props.image.width ?? 1024
    const sourceHeight = props.image.height ?? 1024
    const maxWidth = Math.min(320, stage().width * 0.42)
    const maxHeight = stage().height * 0.56
    const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    return {
      x: (stage().width - width) / 2,
      y: (stage().height - height) / 2,
      width,
      height,
    }
  })

  createEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setStage({
        width: Math.max(360, entry.contentRect.width),
        height: Math.max(280, entry.contentRect.height),
      })
    })
    observer.observe(stageRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(
    on(
      () => `${props.image.id}:${stage().width}:${stage().height}`,
      () => setRect(imageBox()),
      { defer: true },
    ),
  )

  function applyRatio(ratio: StudioAspectRatio) {
    props.onAspectRatio(ratio)
    setRect(ratioBox(imageBox(), stage(), ratio))
  }

  function handlePointerDown(handle: OutpaintHandle, event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startRect = rect() ?? imageBox()
    function onMove(moveEvent: PointerEvent) {
      setRect(resizeOutpaintBox({
        rect: startRect,
        imageBox: imageBox(),
        stage: stage(),
        handle,
        dx: moveEvent.clientX - startX,
        dy: moveEvent.clientY - startY,
      }))
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
  }

  const outpaintMetrics = createMemo(() => {
    const current = rect() ?? imageBox()
    const scale = imageBox().width / (props.image.width ?? 1024)
    const left = Math.round((imageBox().x - current.x) / scale)
    const right = Math.round((current.x + current.width - imageBox().x - imageBox().width) / scale)
    const top = Math.round((imageBox().y - current.y) / scale)
    const bottom = Math.round((current.y + current.height - imageBox().y - imageBox().height) / scale)
    return {
      left: Math.max(0, left),
      right: Math.max(0, right),
      top: Math.max(0, top),
      bottom: Math.max(0, bottom),
      realWidth: Math.round(current.width / scale),
      realHeight: Math.round(current.height / scale),
    }
  })
  const canSubmit = createMemo(() =>
    outpaintMetrics().left > 0 ||
    outpaintMetrics().right > 0 ||
    outpaintMetrics().top > 0 ||
    outpaintMetrics().bottom > 0,
  )
  return (
    <div class="studio-enlarging">
      <div class="studio-enlarging-header">
        <div class="min-w-0">
          <div class="studio-enlarging-title">扩图</div>
          <div class="studio-enlarging-meta">
            {currentImageName(props.image)} · {props.image.width ?? "-"} x {props.image.height ?? "-"} {"->"} {outpaintMetrics().realWidth} x {outpaintMetrics().realHeight}
          </div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-enlarging-close" aria-label="关闭扩图" title="关闭扩图" />
      </div>
      <div class="studio-enlarging-body">
        <div ref={stageRef!} class="studio-enlarging-canvas-wrap">
          <div class="studio-enlarging-stage" style={{ width: `${stage().width}px`, height: `${stage().height}px` }}>
            <div
              class="studio-enlarging-selection"
              style={{
                left: `${(rect() ?? imageBox()).x}px`,
                top: `${(rect() ?? imageBox()).y}px`,
                width: `${(rect() ?? imageBox()).width}px`,
                height: `${(rect() ?? imageBox()).height}px`,
              }}
            >
              <For each={[
                ["top-left", "nwse-resize"],
                ["top", "ns-resize"],
                ["top-right", "nesw-resize"],
                ["left", "ew-resize"],
                ["right", "ew-resize"],
                ["bottom-left", "nesw-resize"],
                ["bottom", "ns-resize"],
                ["bottom-right", "nwse-resize"],
              ] as const}>
                {(item) => (
                  <button
                    type="button"
                    class={`studio-enlarging-handle studio-enlarging-handle-${item[0]}`}
                    style={{ cursor: item[1] }}
                    aria-label={`调整${item[0]}`}
                    onPointerDown={(event) => handlePointerDown(item[0], event)}
                  />
                )}
              </For>
            </div>
            <img
              src={props.image.url}
              class="studio-enlarging-image"
              style={{
                left: `${imageBox().x}px`,
                top: `${imageBox().y}px`,
                width: `${imageBox().width}px`,
                height: `${imageBox().height}px`,
              }}
              alt="Outpaint source"
            />
          </div>
        </div>
        <div class="studio-enlarging-controls">
          <div class="studio-enlarging-ratios" aria-label="扩图比例">
          <For each={ratios}>
            {(item) => (
              <button
                type="button"
                onClick={() => applyRatio(item)}
                class="studio-enlarging-ratio"
                classList={{ active: item === props.aspectRatio }}
              >
                {item}
              </button>
            )}
          </For>
            <span class="studio-enlarging-distance">
              左 {outpaintMetrics().left} · 右 {outpaintMetrics().right} · 上 {outpaintMetrics().top} · 下 {outpaintMetrics().bottom}
            </span>
          </div>
          <div class="studio-enlarging-prompt-row">
          <textarea
            class="studio-enlarging-prompt"
            maxlength="2000"
            placeholder="描述希望扩展出的画面内容"
            value={editorPrompt()}
            onInput={(event) => setEditorPrompt(event.currentTarget.value)}
          />
          <button type="button" onClick={() => setRect(imageBox())} class="studio-enlarging-reset">重置</button>
          <button
            type="button"
            disabled={!canSubmit()}
            onClick={() => props.onSubmit({
              prompt: editorPrompt().trim(),
              extra: {
                ...outpaintMetrics(),
                numImage: 1,
                ratio: props.aspectRatio,
              },
            })}
            class="studio-enlarging-create disabled:opacity-45"
          >
            一键生成
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function currentImageName(image: StudioImage) {
  return image.localPath?.split("/").at(-1) ?? image.id
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="studio-detail-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function StudioGlassSphere(): JSX.Element {
  return (
    <div
      class="w-[210px] h-[210px] rounded-full"
      style={{
        background:
          "radial-gradient(circle at 35% 24%, rgba(133,207,255,0.95), transparent 23%), radial-gradient(circle at 36% 42%, rgba(191,137,255,0.72), transparent 30%), radial-gradient(circle at 68% 68%, rgba(255,255,255,0.9), transparent 22%), linear-gradient(135deg, rgba(156,185,255,0.64), rgba(213,243,255,0.88))",
        "box-shadow": "0 28px 80px rgba(73, 123, 255, 0.25), inset -18px -22px 30px rgba(82, 151, 255, 0.12), inset 12px 14px 28px rgba(255,255,255,0.52)",
      }}
    />
  )
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}
