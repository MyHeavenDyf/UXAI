import "./studio.css"
import { MaterialMenu, type MaterialWordBook } from "./MaterialMenu"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { batch, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX, type Resource } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { authTokenFromCredentials } from "@/utils/server"
import { useServer, ServerConnection } from "@/context/server"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import IllustrationInsightEmpty from "./IllustrationInsightEmpty.svg"
import {
  STUDIO_ASPECT_RATIOS,
  STUDIO_CAPABILITIES,
  STUDIO_STYLE_MODELS,
  capabilityLabel,
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
} from "./types"
import {
  buildStudioDisplayPrompt,
  buildStudioTurns,
  type StudioTurnData,
} from "./turns"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])
const SUPPORTED_STUDIO_CAPABILITIES = new Set<StudioCapability>([
  "image.generate",
  "video.generate",
  "image.upscale",
  "image.cutout",
  "image.inpaint",
  "image.outpaint",
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

type StudioHDMode = "restoration_8k" | "restoration" | "super_restoration"
type StudioInpaintMode = "qwen_image_edit" | "erase"
type StudioVideoDuration = "5" | "10"
type StudioVideoQualityMode = "std" | "pro"
type StudioVideoFrameSlot = "first" | "last"
const STUDIO_HD_MODES = [
  { label: "8k超清", value: "restoration_8k" },
  { label: "4k清晰", value: "restoration" },
  { label: "2k性能", value: "super_restoration" },
] satisfies { label: string; value: StudioHDMode }[]
const STUDIO_VIDEO_ASPECT_RATIOS = ["1:1", "9:16", "16:9"] as const

function workspaceModeForCapability(capability: StudioCapability): Exclude<StudioMode, "preview"> | undefined {
  if (capability === "image.upscale") return "hd"
  if (capability === "image.cutout") return "cutout"
  if (capability === "image.inpaint") return "inpaint"
  if (capability === "image.outpaint") return "outpaint"
  return undefined
}

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function stringValue(value: unknown, key: string) {
  const next = recordValue(value, key)
  return typeof next === "string" ? next : undefined
}

function uiplusUserAccount() {
  const account = recordValue(JSON.parse(localStorage.getItem("uiplusUser") || "{}"), "account")
  return typeof account === "string" ? account : undefined
}

function studioResultTaskType(result: StudioGenerationResult) {
  return (
    result.task_type ??
    result.taskType ??
    stringValue(result.request, "task_type") ??
    stringValue(result.request, "taskType") ??
    stringValue(recordValue(result.request, "body"), "task_type") ??
    stringValue(recordValue(result.request, "body"), "taskType") ??
    stringValue(result.response, "task_type") ??
    stringValue(result.response, "taskType")
  )
}

function isStudioEditResult(result: StudioGenerationResult) {
  const taskType = studioResultTaskType(result)
  if (taskType === "magnify" || taskType === "remove_bg" || taskType === "inpainting" || taskType === "outpainting") return true
  if (result.capability === "image.upscale" || result.capability === "image.cutout" || result.capability === "image.inpaint" || result.capability === "image.outpaint") return true
  return result.toolAction === "super_resolution" || result.toolAction === "cutout" || result.toolAction === "inpainting" || result.toolAction === "outpainting"
}

function studioGenerationTitle(capability: StudioCapability | undefined, status: "running" | "succeeded" | "failed") {
  const label = capability === "video.generate" ? "视频生成" : "图片生成"
  if (status === "failed") return `${label}失败`
  if (status === "succeeded") return `${label}完成`
  return `${label}中`
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

function isVideoMedia(image?: StudioImage) {
  if (!image) return false
  if (image.kind === "video") return true
  return /^data:video\//i.test(image.url) || /\.(mp4|mov|webm)(?:[?#]|$)/i.test(image.url)
}

function hasVideoFrameAssets(frames: { first?: StudioAsset; last?: StudioAsset }) {
  return Boolean(frames.first || frames.last)
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
  const dialog = useDialog()

  const projectDir = useProjectDir({ mode: "config" })
  const [syncStore, setSyncStore] = globalSync.child(projectDir(), { bootstrap: true })

  const isValidStudioSession = (sessionId: string | undefined): boolean => {
    if (!sessionId) return false
    const session = syncStore.session.find(s => s.id === sessionId)
    return session?.agent === "octo_studio"
  }
  const activeStudioSession = createMemo(() => {
    if (!params.id) return
    return syncStore.session.find((session) => session.id === params.id && session.agent === "octo_studio")
  })

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
  const [assets, setAssets] = createSignal<StudioAsset[]>([])
  const [videoFrames, setVideoFrames] = createStore<{ first?: StudioAsset; last?: StudioAsset }>({})
  const [videoDuration, setVideoDuration] = createSignal<StudioVideoDuration>("5")
  const [videoQualityMode, setVideoQualityMode] = createSignal<StudioVideoQualityMode>("std")
  const [status, setStatus] = createSignal<StudioGenerationStatus>("idle")
  const [pendingResult, setPendingResult] = createSignal<StudioPendingResult>()
  const [selectedResultId, setSelectedResultId] = createSignal<string>()
  const [selectedImageId, setSelectedImageId] = createSignal<string>()
  const [workspaceImage, setWorkspaceImage] = createSignal<StudioImage>()
  const [workspaceUploadRequested, setWorkspaceUploadRequested] = createSignal(false)
  const [editEntryTurn, setEditEntryTurn] = createSignal<StudioTurnData>()
  const [wordBook] = createResource<MaterialWordBook[], ServerConnection.Any>(
    () => server.current,
    async (current) => {
      const headers: Record<string, string> = {
        accept: "application/json",
        "x-opencode-directory": projectDir(),
      }
      if (current.http.password) {
        headers.Authorization = `Basic ${authTokenFromCredentials({
          username: current.http.username,
          password: current.http.password,
        })}`
      }
      const response = await fetch(new URL("/studio/prompt-tags", current.http.url), {
        method: "GET",
        headers,
      })
      if (!response.ok) throw new Error(`get_prompt_tags failed: ${response.status}`)
      const json = await response.json() as unknown
      if (Array.isArray(json)) return json as MaterialWordBook[]
      const record = json as Record<string, unknown>
      const data = record.data ?? record.result ?? record.tags
      if (Array.isArray(data)) return data as MaterialWordBook[]
      throw new Error("Unexpected get_prompt_tags response shape")
    },
  )
  const [openMenu, setOpenMenu] = createSignal<"capability" | "style" | "settings" | "material" | null>(null)
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
  let videoFrameInputRef!: HTMLInputElement
  let pendingVideoFrameSlot: StudioVideoFrameSlot = "first"
  let conversationScrollRef!: HTMLDivElement
  let scrollFrame = 0
  let pendingEditorSessionID: string | undefined
  const blobUrlCache = new Map<string, string>()

  function replaceVideoFrames(frames: { first?: StudioAsset; last?: StudioAsset }) {
    setVideoFrames(reconcile(frames))
  }

  function clearVideoFrames() {
    replaceVideoFrames({})
  }

  function displayUrl(url: string) {
    if (!url.startsWith("data:image/") && !url.startsWith("data:video/")) return url
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
      kind: image.kind ?? (isVideoMedia(image) ? "video" : "image"),
      url: displayUrl(image.url),
      thumbnailUrl: displayUrl(thumbnailSource),
      remoteUrl,
    }
  }

  function readWorkspaceImage(file: File) {
    return new Promise<StudioImage>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result
        if (typeof dataUrl !== "string") {
          reject(new Error("Unable to read image file."))
          return
        }
        const image = new Image()
        image.onload = () => resolve({
          id: crypto.randomUUID(),
          url: displayUrl(dataUrl),
          thumbnailUrl: displayUrl(dataUrl),
          remoteUrl: dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        })
        image.onerror = () => resolve({
          id: crypto.randomUUID(),
          url: displayUrl(dataUrl),
          thumbnailUrl: displayUrl(dataUrl),
          remoteUrl: dataUrl,
        })
        image.src = dataUrl
      }
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read image file."))
      reader.readAsDataURL(file)
    })
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
    const addActive = (url?: string) => {
      if (url?.startsWith("data:image/") || url?.startsWith("data:video/")) active.add(url)
    }
    for (const turn of turns()) {
      for (const image of turn.result?.images ?? []) {
        addActive(image.url)
        addActive(image.thumbnailUrl)
        addActive(image.remoteUrl)
      }
    }
    for (const image of pendingResult()?.images ?? []) {
      addActive(image.url)
      addActive(image.thumbnailUrl)
      addActive(image.remoteUrl)
    }
    const uploaded = workspaceImage()
    addActive(uploaded?.url)
    addActive(uploaded?.thumbnailUrl)
    addActive(uploaded?.remoteUrl)
    addActive(videoFrames.first?.dataUrl)
    addActive(videoFrames.last?.dataUrl)
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
          toolTitle: studioGenerationTitle(pending.capability, pending.status === "failed" ? "failed" : pending.status === "succeeded" ? "succeeded" : "running"),
          toolName: `内部 · ${pending.status === "failed" ? "失败" : pending.status === "succeeded" ? "完成" : "生成中"}`,
          toolRunning: pending.status === "running",
          result: normalizeResultValue(pending),
        }
      })
      const entry = editEntryTurn()
      if (entry) {
        const withLatest = next.map((turn) => ({ ...turn, isLatest: false }))
        return [...withLatest, { ...entry, isLatest: true }]
      }
      if (!pending) return next
      const latest = next.at(-1)
      if (latest?.userText === pending.prompt && !latest.result?.images.length && latest.toolRunning) {
        if (pending.status === "failed") {
          return [
            ...next.slice(0, -1),
            {
              ...latest,
              toolTitle: studioGenerationTitle(pending.capability, "failed"),
              toolName: "内部 · 失败",
              toolRunning: false,
              result: normalizeResultValue(pending),
            },
          ]
        }
        if (pending.status !== "succeeded" || pending.images.length === 0) return next
        return [
          ...next.slice(0, -1),
          {
            ...latest,
            assistantText: latest.assistantText || buildStudioThinkingText({
              text: pending.prompt,
              capability: pending.capability,
              sourceImage: pending.sourceImage,
            }),
            toolTitle: studioGenerationTitle(pending.capability, "succeeded"),
            toolName: "内部 · 完成",
            toolRunning: false,
            result: normalizeResultValue(pending),
          },
        ]
      }
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
          toolTitle: studioGenerationTitle(pending.capability, pending.status === "failed" ? "failed" : "running"),
          toolName: `内部 · ${pending.status === "failed" ? "失败" : "生成中"}`,
          result: normalizeResultValue(pending),
          createdAt: pending.createdAt,
          isLatest: true,
        } satisfies StudioTurnData,
      ]
    })(),
  )
  const studioTurn = createMemo(() => turns().at(-1))
  const latestCompletedTurn = createMemo(() => [...turns()].reverse().find((turn) => (turn.result?.images.length ?? 0) > 0))
  const defaultResult = createMemo(() => studioTurn()?.result ?? latestCompletedTurn()?.result ?? pendingResult())
  const selectedResult = createMemo(() => {
    const id = selectedResultId()
    if (!id) return
    return displayTurns()
      .map((turn) => turn.result)
      .find((item): item is StudioGenerationResult => item?.id === id)
  })
  const result = createMemo(() => normalizeResultValue(selectedResult() ?? defaultResult()))
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
  const workspaceEditImage = createMemo(() => workspaceImage() ?? (workspaceUploadRequested() ? undefined : selectedImage()))

  createEffect(() => {
    const first = result()?.images[0]?.id
    if (first && !result()?.images.some((image) => image.id === selectedImageId())) setSelectedImageId(first)
  })

  function selectStudioImage(input: { resultID: string; imageID: string }) {
    batch(() => {
      setSelectedResultId(input.resultID)
      setSelectedImageId(input.imageID)
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("preview")
    })
  }

  createEffect(() => {
    const pending = pendingResult()
    if (!pending) return
    if (studioTurn()?.id === pending.id) return
    if (studioTurn()?.userText !== pending.prompt) return
    if (pending.status === "failed" && studioTurn()?.toolRunning) return
    if (pending.status === "succeeded" && pending.images.length > 0 && studioTurn()?.toolRunning) return
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
    if (pending.status === "succeeded" && pending.images.length > 0 && studioTurn()?.toolRunning) {
      setStatus("succeeded")
      return
    }
    if (pending.status === "failed" && studioTurn()?.toolRunning) {
      setStatus("failed")
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
        const preserveEditorEntry = Boolean(id && id === pendingEditorSessionID)
        if (preserveEditorEntry) pendingEditorSessionID = undefined
        if (!id && !sending() && !pendingResult()) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        if (id && !sending()) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        if (!preserveEditorEntry) {
          setEditEntryTurn(undefined)
          setCapability("image.generate")
        }
        setSelectedImageId(undefined)
        setSelectedResultId(undefined)
        setWorkspaceImage(undefined)
        setWorkspaceUploadRequested(preserveEditorEntry)
        setMode(preserveEditorEntry ? mode() : "preview")
        setAssets([])
        clearVideoFrames()
        setPrompt("")
      },
      { defer: true },
    ),
  )

  const selectedCapabilityNeedsImage = createMemo(() =>
    capability() === "image.upscale" || capability() === "image.cutout" || capability() === "image.inpaint" || capability() === "image.outpaint",
  )
  const hasVideoFrames = createMemo(() => hasVideoFrameAssets(videoFrames))
  const videoQualityLocked = createMemo(() => Boolean(videoFrames.first && videoFrames.last))
  createEffect(() => {
    if (videoQualityLocked()) setVideoQualityMode("pro")
  })
  const canSubmit = createMemo(() =>
    SUPPORTED_STUDIO_CAPABILITIES.has(capability()) &&
    !isBusy() &&
    (
      capability() === "video.generate"
        ? prompt().trim().length > 0 || hasVideoFrames()
        : prompt().trim().length > 0 || (selectedCapabilityNeedsImage() && Boolean(workspaceEditImage()))
    ),
  )
  const isEditingWorkspaceMode = createMemo(() => mode() !== "preview")
  const currentTitle = createMemo(() =>
    sessionTitle(activeStudioSession()?.title) ??
    (result()?.prompt
      ? buildStudioDisplayPrompt(result()!.prompt)
      : studioTurn()?.userText || "Octo Studio"),
  )
  const [headerTitle, setHeaderTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    saving: false,
  })
  let headerTitleRef: HTMLInputElement | undefined

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const openHeaderTitleEditor = () => {
    const session = activeStudioSession()
    if (!session) return
    setHeaderTitle({ editing: true, draft: sessionTitle(session.title) ?? "" })
    requestAnimationFrame(() => {
      headerTitleRef?.focus()
      headerTitleRef?.select()
    })
  }

  const closeHeaderTitleEditor = () => {
    if (headerTitle.saving) return
    setHeaderTitle({ editing: false, draft: "" })
  }

  const saveHeaderTitleEditor = async () => {
    const session = activeStudioSession()
    if (!session || headerTitle.saving) return

    const next = headerTitle.draft.trim()
    if (!next || next === (sessionTitle(session.title) ?? "")) {
      setHeaderTitle({ editing: false, draft: "" })
      return
    }

    setHeaderTitle("saving", true)
    await globalSDK.createClient({ directory: projectDir() }).session
      .update({ sessionID: session.id, title: next })
      .then(() => {
        setSyncStore(
          produce((draft) => {
            const index = draft.session.findIndex((item) => item.id === session.id)
            if (index !== -1) draft.session[index].title = next
          }),
        )
        setHeaderTitle({ editing: false, draft: "" })
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
      .finally(() => setHeaderTitle("saving", false))
  }

  const deleteHeaderSession = async (session: Session) => {
    const sessions = syncStore.session
      .filter((item) => item.agent === "octo_studio" && !item.time?.archived)
      .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
    const index = sessions.findIndex((item) => item.id === session.id)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])
    const result = await globalSDK.createClient({ directory: projectDir() }).session
      .delete({ sessionID: session.id })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    setSyncStore(
      produce((draft) => {
        const index = draft.session.findIndex((item) => item.id === session.id)
        if (index !== -1) draft.session.splice(index, 1)
      }),
    )
    if (nextSession) {
      navigate(`/${slug()}/studio/${nextSession.id}`)
      return true
    }
    layout.lastSessionPerTab.setStudio(projectDir(), "")
    navigate(`/${slug()}/studio`)
    return true
  }

  function DialogDeleteHeaderSession(props: { session: Session }) {
    const name = createMemo(() => sessionTitle(props.session.title) ?? language.t("command.session.new"))
    const handleDelete = async () => {
      await deleteHeaderSession(props.session)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }
  const currentImageLabel = createMemo(() => {
    const image = selectedImage()
    const images = result()?.images ?? []
    const index = image ? images.findIndex((item) => item.id === image.id) + 1 : 1
    const video = isVideoMedia(image)
    const prefix = currentTitle() === "Octo Studio" ? (video ? "studio-video" : "studio-image") : currentTitle().replace(/[\\/:*?\"<>|]/g, "-").slice(0, 24)
    return `${prefix}-${Math.max(index, 1)}.${video ? "mp4" : "png"}`
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

  createEffect(
    on(
      capability,
      (value) => {
        const nextMode = workspaceModeForCapability(value)
        if (!nextMode) {
          batch(() => {
            setWorkspaceImage(undefined)
            setWorkspaceUploadRequested(false)
            setMode("preview")
          })
          return
        }
        batch(() => {
          setWorkspaceImage(undefined)
          setWorkspaceUploadRequested(true)
          setMode(nextMode)
        })
      },
      { defer: true },
    ),
  )

  function readStudioAsset(file: File) {
    return new Promise<StudioAsset>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result
        if (typeof dataUrl !== "string") {
          reject(new Error("Unable to read image file."))
          return
        }
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          mime: file.type || "application/octet-stream",
          dataUrl,
        })
      }
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read image file."))
      reader.readAsDataURL(file)
    })
  }

  async function validateVideoFrame(file: File) {
    if (!file.type.startsWith("image/")) throw new Error("请上传图片文件。")
    if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB。")
    const asset = await readStudioAsset(file)
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const minSide = Math.min(image.naturalWidth, image.naturalHeight)
        const maxSide = Math.max(image.naturalWidth, image.naturalHeight)
        if (minSide < 300) {
          reject(new Error("图片最小边不能小于 300px。"))
          return
        }
        if (maxSide / minSide > 2.5) {
          reject(new Error("图片长短边比例不能超过 2.5。"))
          return
        }
        resolve()
      }
      image.onerror = () => reject(new Error("无法读取图片尺寸。"))
      image.src = asset.dataUrl
    })
    return asset
  }

  function addAssets(files: File[]) {
    const file = files.find((item) => item.type.startsWith("image/"))
    if (!file) return
    readStudioAsset(file)
      .then((asset) => setAssets([asset]))
      .catch((error) => {
        showToast({
          title: "上传失败",
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  function addVideoFrame(slot: StudioVideoFrameSlot, files: File[]) {
    const file = files.find((item) => item.type.startsWith("image/"))
    if (!file) return
    validateVideoFrame(file)
      .then((asset) => setVideoFrames(slot, asset))
      .catch((error) => {
        showToast({
          title: "上传失败",
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.files?.length) addAssets(Array.from(input.files))
    input.value = ""
  }

  function handleVideoFrameFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.files?.length) addVideoFrame(pendingVideoFrameSlot, Array.from(input.files))
    input.value = ""
  }

  function handlePasteReferenceImage(files: File[]) {
    if (capability() === "video.generate") {
      addVideoFrame(videoFrames.first ? "last" : "first", files)
      return
    }
    addAssets(files.filter((file) => file.type.startsWith("image/")))
  }

  function uploadWorkspaceImage(files: File[]) {
    const file = files.find((item) => item.type.startsWith("image/"))
    if (!file) return
    readWorkspaceImage(file)
      .then((image) => {
        batch(() => {
          setWorkspaceImage(image)
          setWorkspaceUploadRequested(false)
          setSelectedResultId(undefined)
          setSelectedImageId(undefined)
        })
      })
      .catch((error) => console.error("[StudioPage] workspace image upload failed", error))
  }

  function deleteWorkspaceImage() {
    batch(() => {
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(true)
      setSelectedResultId(undefined)
      setSelectedImageId(undefined)
    })
  }

  function openEditorEntry(value: StudioCapability) {
    const nextMode = workspaceModeForCapability(value)
    if (!nextMode) return
    batch(() => {
      setCapability(value)
      setPrompt("")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(true)
      setSelectedResultId(undefined)
      setSelectedImageId(undefined)
      setMode(nextMode)
    })
  }

  function createEditorEntry(value: StudioCapability) {
    const nextMode = workspaceModeForCapability(value)
    if (!nextMode) return
    const label = capabilityLabel(value)
    batch(() => {
      setEditEntryTurn({
        id: `studio_edit_${value}_${Date.now()}`,
        userText: label,
        assistantText: "点击前往编辑区",
        editCapability: value,
        createdAt: Date.now(),
        isLatest: true,
      })
      setPrompt("")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(true)
      setSelectedResultId(undefined)
      setSelectedImageId(undefined)
      setMode(nextMode)
    })
    if (params.id) return
    createStudioSession(label)
      .then((sessionID) => {
        if (!sessionID) return
        pendingEditorSessionID = sessionID
        navigate(`/${slug()}/studio/${sessionID}`)
        requestAnimationFrame(() => openEditorEntry(value))
      })
      .catch((error) => console.error("[StudioPage] editor session create failed", error))
  }

  function selectStudioCapability(value: StudioCapability) {
    setCapability(value)
    if (value === "video.generate" && !STUDIO_VIDEO_ASPECT_RATIOS.includes(aspectRatio() as (typeof STUDIO_VIDEO_ASPECT_RATIOS)[number])) {
      setAspectRatio("16:9")
    }
    if (value !== "video.generate") clearVideoFrames()
    if (value !== "image.generate") setAssets([])
    if (workspaceModeForCapability(value)) {
      createEditorEntry(value)
      return
    }
    batch(() => {
      setEditEntryTurn(undefined)
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("preview")
    })
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
        : input.capability === "image.inpaint"
          ? "好的，我将根据涂抹区域智能重绘当前图片。"
        : input.capability === "image.outpaint"
          ? `好的，我将扩展当前图片为${aspectRatio()}比例。`
          : input.capability === "video.generate"
            ? `好的，我将为您生成一段${aspectRatio()}比例的视频。`
          : `好的，我将为您生成一张${aspectRatio()}比例的${capabilityLabel(input.capability)}。`
    return [
      opening,
      input.capability === "video.generate" ? undefined : `风格模型：${styleModelLabel(styleModel())}`,
      `画幅比例：${aspectRatio()}`,
      `生成数量：${count()}`,
      input.sourceImage
        ? "将延续上一轮画面设定重新生成。"
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
    referenceImages?: string[]
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
        styleModel: input.capability === "video.generate" ? undefined : styleModelLabel(styleModel()),
        aspectRatio: aspectRatio(),
        count: count(),
        imageTool: "internel",
        referenceImages: input.referenceImages ?? [],
        sourceImage: input.sourceImage,
        extra: {
          ...input.extra,
          userIdx: uiplusUserAccount(),
        },
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
    const nextVideoFrames = videoFrames
    const nextHasVideoFrames = nextCapability === "video.generate" && hasVideoFrameAssets(nextVideoFrames)
    const text = (overrides?.prompt ?? prompt()).trim() || (
      nextCapability === "image.upscale"
        ? "将当前图片变清晰，提升分辨率和细节"
        : nextCapability === "image.cutout"
          ? "对当前图片进行抠图，移除背景并保留主体"
          : nextCapability === "image.inpaint"
            ? "重绘所选区域"
          : nextCapability === "image.outpaint"
            ? "保留主体和画面风格，扩展更大尺寸和更多环境内容"
            : nextCapability === "video.generate" && nextHasVideoFrames
              ? "根据首尾帧生成自然连贯的视频"
            : ""
    )
    if (!text || isBusy()) return
    const previousPrompt = prompt()
    const previousVideoFrames = { first: videoFrames.first, last: videoFrames.last }
    const videoReferenceImages = [
      nextVideoFrames.first?.dataUrl ?? nextVideoFrames.last?.dataUrl,
      nextVideoFrames.first ? nextVideoFrames.last?.dataUrl : undefined,
    ].filter((item): item is string => Boolean(item))
    const referenceImages =
      nextCapability === "image.generate"
        ? assets().map((item) => item.dataUrl)
        : nextCapability === "video.generate"
          ? videoReferenceImages
          : []
    setOpenMenu(null)
    setMode("preview")
    setEditEntryTurn(undefined)
    setSending(true)
    setStatus("submitting")
    setSelectedResultId(undefined)
    setPendingResult({
      id: `studio_pending_${Date.now()}`,
      status: "running",
      capability: nextCapability,
      prompt: text,
      provider: "internel",
      model: styleModelLabel(styleModel()),
      aspectRatio: aspectRatio(),
      images: [],
      createdAt: Date.now(),
      sourceImage: overrides?.sourceImage,
      ...(nextCapability === "video.generate"
        ? {
            videoMode: nextHasVideoFrames ? "first_last_frame" : "text",
            duration: videoDuration(),
            videoQualityMode: videoQualityMode(),
          }
        : {}),
    })
    setPrompt("")
    setAssets([])
    if (nextCapability === "video.generate") clearVideoFrames()
    try {
      const existingSession = isValidStudioSession(params.id)
      const sessionID = existingSession ? params.id! : await createStudioSession(text)
      if (!sessionID) throw new Error("Unable to create Studio session.")
      if (!existingSession) navigate(`/${slug()}/studio/${sessionID}`)
      const generation = await createStudioGeneration({
        sessionID,
        text,
        capability: nextCapability,
        referenceImages,
        sourceImage: overrides?.sourceImage,
        extra: {
          ...(overrides?.extra ?? {}),
          ...(nextCapability === "video.generate"
            ? {
                videoMode: nextHasVideoFrames ? "first_last_frame" : "text",
                duration: videoDuration(),
                mode: videoQualityMode(),
                firstFrame: nextVideoFrames.first?.dataUrl ?? nextVideoFrames.last?.dataUrl,
                lastFrame: nextVideoFrames.first ? nextVideoFrames.last?.dataUrl : undefined,
              }
            : {}),
        },
      })
      setPendingResult({
        ...generation,
        sourceImage: overrides?.sourceImage,
      })
      await loadSessionMessages(sessionID)
      setStatus("succeeded")
    } catch (error) {
      console.error("[StudioPage] studio prompt failed", error)
      setPrompt(previousPrompt)
      if (nextCapability === "video.generate") replaceVideoFrames(previousVideoFrames)
      setStatus("failed")
      setPendingResult((item) => item ? { ...item, status: "failed", error: error instanceof Error ? error.message : String(error) } : item)
    } finally {
      setSending(false)
    }
  }

  function handleSubmit() {
    if (!SUPPORTED_STUDIO_CAPABILITIES.has(capability())) return
    if (capability() === "image.upscale") {
      setMode("hd")
      return
    }
    if (capability() === "image.inpaint") {
      setMode("inpaint")
      return
    }
    if (capability() === "image.cutout") {
      setMode("cutout")
      return
    }
    if (capability() === "image.outpaint") {
      const image = workspaceEditImage()
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
    if (!selectedImage() || isVideoMedia(selectedImage())) return
    batch(() => {
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("outpaint")
    })
  }

  function openHD() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isBusy()) return
    batch(() => {
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("hd")
    })
  }

  function openCutout() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isBusy()) return
    batch(() => {
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("cutout")
    })
  }

  function openInpaint() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isBusy()) return
    batch(() => {
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("inpaint")
    })
  }

  function submitOutpaint(input: { prompt: string; extra: Record<string, unknown> }) {
    const image = workspaceEditImage()
    if (!image) return
    void runGeneration({
      capability: "image.outpaint",
      sourceImage: image.remoteUrl ?? image.url,
      prompt: input.prompt || "保留主体和画面风格，扩展更大尺寸和更多环境内容",
      extra: input.extra,
    })
  }

  function submitInpaint(input: {
    prompt: string
    mode: StudioInpaintMode
    sourceImage: string
    compositeImage: string
    hasDrawing: boolean
  }) {
    if (isBusy() || !input.hasDrawing) return
    void runGeneration({
      capability: "image.inpaint",
      sourceImage: input.sourceImage,
      prompt: input.prompt || (input.mode === "erase" ? "消除涂抹区域内的物体" : "重绘所选区域"),
      extra: {
        generateMode: input.mode,
        compositeImage: input.compositeImage,
        hasDrawing: input.hasDrawing,
      },
    })
  }

  function submitHD(input: { mode: StudioHDMode }) {
    const image = workspaceEditImage()
    if (!image || isBusy()) return
    void runGeneration({
      capability: "image.upscale",
      sourceImage: image.remoteUrl ?? image.url,
      prompt: "将当前图片变清晰，提升分辨率和细节",
      extra: {
        mode: input.mode,
      },
    })
  }

  function submitCutout() {
    const image = workspaceEditImage()
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

  const hasStudioConversation = createMemo(() =>
    turns().length > 0 ||
    Boolean(editEntryTurn()) ||
    Boolean(pendingResult()) ||
    sending() ||
    isEditingWorkspaceMode() ||
    Boolean(workspaceModeForCapability(capability())),
  )

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
                  <div class="absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none -top-7" data-component="tooltip">
                    {language.t("prompt.hint.newSession")}
                  </div>
                </Show>
                <StudioComposer
                  prompt={prompt()}
                  capability={capability()}
                  styleModel={styleModel()}
                  aspectRatio={aspectRatio()}
                  count={count()}
                  assets={assets()}
                  videoFrames={videoFrames}
                  videoDuration={videoDuration()}
                  videoQualityMode={videoQualityMode()}
                  videoQualityLocked={videoQualityLocked()}
                  status={effectiveStatus()}
                  openMenu={openMenu()}
                  canSubmit={canSubmit()}
                  wordBook={wordBook}
                  onPrompt={setPrompt}
                  onCapability={selectStudioCapability}
                  onStyleModel={setStyleModel}
                  onAspectRatio={setAspectRatio}
                  onCount={setCount}
                  onVideoDuration={setVideoDuration}
                  onVideoQualityMode={setVideoQualityMode}
                  onOpenMenu={setOpenMenu}
                  onSubmit={handleSubmit}
                  onKeyDown={handleKeyDown}
                  onPickFile={() => fileInputRef.click()}
                  onPickVideoFrame={(slot) => {
                    pendingVideoFrameSlot = slot
                    videoFrameInputRef.click()
                  }}
                  onPasteImage={handlePasteReferenceImage}
                  onRemoveAsset={(id) => setAssets((items) => items.filter((item) => item.id !== id))}
                  onRemoveVideoFrame={(slot) => setVideoFrames(slot, undefined)}
                  onSwapVideoFrames={() => replaceVideoFrames({ first: videoFrames.last, last: videoFrames.first })}
                />
            </div>
          </div>
        </div>
        </main>
      }>
        <section class="studio-center" style={{ width: `${studioCenterWidth()}px`, flex: `0 0 ${studioCenterWidth()}px` }}>
          <div class="studio-center-header">
            <Show
              when={headerTitle.editing}
              fallback={<div class="studio-center-title">{currentTitle()}</div>}
            >
              <InlineInput
                ref={(el) => {
                  headerTitleRef = el
                }}
                value={headerTitle.draft}
                disabled={headerTitle.saving}
                class="studio-center-title studio-center-title-input"
                onInput={(event) => setHeaderTitle("draft", event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveHeaderTitleEditor()
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    closeHeaderTitleEditor()
                  }
                }}
                onBlur={() => void saveHeaderTitleEditor()}
              />
            </Show>
            <Show when={activeStudioSession()} keyed>
              {(session) => (
                <DropdownMenu
                  gutter={4}
                  placement="bottom-end"
                  open={headerTitle.menuOpen}
                  onOpenChange={(open) => setHeaderTitle("menuOpen", open)}
                >
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="dot-grid"
                    variant="ghost"
                    class="studio-center-action size-7 rounded-md data-[expanded]:bg-surface-base-active"
                    aria-label={language.t("common.moreOptions")}
                    aria-expanded={headerTitle.menuOpen}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      style={{ "min-width": "104px" }}
                      onCloseAutoFocus={(event) => {
                        if (!headerTitle.pendingRename) return
                        event.preventDefault()
                        setHeaderTitle("pendingRename", false)
                        openHeaderTitleEditor()
                      }}
                    >
                      <DropdownMenu.Item
                        onSelect={() => {
                          setHeaderTitle({
                            pendingRename: true,
                            menuOpen: false,
                          })
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        onSelect={() => dialog.show(() => <DialogDeleteHeaderSession session={session} />)}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              )}
            </Show>
          </div>

          <ScrollView
            viewportRef={(el) => { conversationScrollRef = el }}
            class="studio-center-scroll"
          >
            <Show when={displayTurns().length > 0 || pendingResult() || sending()} fallback={<StudioIntro />}>
              <StudioConversation
                result={result()}
                turns={displayTurns()}
                busy={effectiveStatus() === "running" || effectiveStatus() === "submitting"}
                onSelectImage={selectStudioImage}
                onOpenEditor={openEditorEntry}
              />
            </Show>
          </ScrollView>

          <StudioComposer
            prompt={prompt()}
            capability={capability()}
            styleModel={styleModel()}
            aspectRatio={aspectRatio()}
            count={count()}
            assets={assets()}
            videoFrames={videoFrames}
            videoDuration={videoDuration()}
            videoQualityMode={videoQualityMode()}
            videoQualityLocked={videoQualityLocked()}
            status={effectiveStatus()}
            openMenu={openMenu()}
            canSubmit={canSubmit()}
            wordBook={wordBook}
            onPrompt={setPrompt}
            onCapability={selectStudioCapability}
            onStyleModel={setStyleModel}
            onAspectRatio={setAspectRatio}
            onCount={setCount}
            onVideoDuration={setVideoDuration}
            onVideoQualityMode={setVideoQualityMode}
            onOpenMenu={setOpenMenu}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            onPickFile={() => fileInputRef.click()}
            onPickVideoFrame={(slot) => {
              pendingVideoFrameSlot = slot
              videoFrameInputRef.click()
            }}
            onPasteImage={handlePasteReferenceImage}
            onRemoveAsset={(id) => setAssets((items) => items.filter((item) => item.id !== id))}
            onRemoveVideoFrame={(slot) => setVideoFrames(slot, undefined)}
            onSwapVideoFrames={() => replaceVideoFrames({ first: videoFrames.last, last: videoFrames.first })}
          />
        </section>
        <div
          class="absolute top-0 bottom-0 cursor-col-resize z-10"
          style={{ left: `${studioLeftWidth() + studioCenterWidth() - 4}px`, width: "8px" }}
          onMouseDown={handleStudioCenterResize}
        />

      <main class="studio-workspace">
        <section class="studio-canvas">
          <Show when={isEditingWorkspaceMode()} fallback={
            <StudioResultCanvas
              status={effectiveStatus()}
              image={selectedImage()}
              result={result()}
              imageLabel={currentImageLabel()}
              onDownload={() => void downloadCurrentImage()}
            />
          }>
            <Show when={!workspaceEditImage()}>
              <StudioWorkspaceUpload onUpload={uploadWorkspaceImage} />
            </Show>
            <Show when={mode() === "hd" && workspaceEditImage()}>
              {(image) => (
                <StudioHDEditor
                  image={image()}
                  onClose={() => setMode("preview")}
                  onDelete={deleteWorkspaceImage}
                  onSubmit={submitHD}
                />
              )}
            </Show>
            <Show when={mode() === "cutout" && workspaceEditImage()}>
              {(image) => (
                <StudioCutoutEditor
                  image={image()}
                  busy={isBusy()}
                  onClose={() => setMode("preview")}
                  onDelete={deleteWorkspaceImage}
                  onSubmit={submitCutout}
                />
              )}
            </Show>
            <Show when={mode() === "outpaint" && workspaceEditImage()}>
              {(image) => (
                <StudioOutpaintEditor
                  image={image()}
                  aspectRatio={aspectRatio()}
                  onAspectRatio={setAspectRatio}
                  onClose={() => setMode("preview")}
                  onDelete={deleteWorkspaceImage}
                  onSubmit={submitOutpaint}
                />
              )}
            </Show>
            <Show when={mode() === "inpaint" && workspaceEditImage()}>
              {(image) => (
                <StudioInpaintEditor
                  image={image()}
                  busy={isBusy()}
                  onClose={() => setMode("preview")}
                  onDelete={deleteWorkspaceImage}
                  onSubmit={submitInpaint}
                />
              )}
            </Show>
          </Show>
        </section>

          <Show when={!isEditingWorkspaceMode() && result()?.images.length}>
            <aside class="studio-details">
              <StudioDetails
                result={result()!}
                image={selectedImage()}
                selectedImageId={selectedImageId()}
                imageLabel={currentImageLabel()}
                regenerateDisabled={isBusy()}
                onSelectImage={(id) => setSelectedImageId(id)}
                onRegenerate={regenerateCurrentResult}
                onUpscale={openHD}
                onCutout={openCutout}
                onInpaint={openInpaint}
                onOutpaint={openOutpaint}
              />
            </aside>
          </Show>
        </main>
      </Show>
      <input ref={fileInputRef!} type="file" accept="image/*" class="hidden" onChange={handleFileChange} />
      <input ref={videoFrameInputRef!} type="file" accept="image/png,image/jpeg" class="hidden" onChange={handleVideoFrameFileChange} />
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
  const navigate = useNavigate()
  const layout = useLayout()

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
  const [title, setTitle] = createStore({
    draft: "",
    editingID: "",
    menuOpenID: "",
    pendingRenameID: "",
    savingID: "",
  })
  let titleRef: HTMLInputElement | undefined

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const openTitleEditor = (session: Session) => {
    setTitle({
      draft: sessionTitle(session.title) ?? "",
      editingID: session.id,
      pendingRenameID: "",
    })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (title.savingID) return
    setTitle({ editingID: "", draft: "" })
  }

  const saveTitleEditor = async (session: Session) => {
    if (title.savingID) return

    const next = title.draft.trim()
    if (!next || next === (sessionTitle(session.title) ?? "")) {
      setTitle({ editingID: "", draft: "" })
      return
    }

    setTitle("savingID", session.id)
    await globalSDK.createClient({ directory: props.directory }).session
      .update({ sessionID: session.id, title: next })
      .then(() => {
        setSessionList(
          produce((draft) => {
            const index = draft.findIndex((item) => item.id === session.id)
            if (index !== -1) draft[index].title = next
          }),
        )
        setTitle({ editingID: "", draft: "" })
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
      .finally(() => setTitle("savingID", ""))
  }

  const navigateAfterSessionRemoval = (sessionID: string, nextSessionID?: string) => {
    if (props.activeSessionID !== sessionID) return
    if (nextSessionID) {
      navigate(`/${base64Encode(props.directory)}/studio/${nextSessionID}`)
      return
    }
    layout.lastSessionPerTab.setStudio(props.directory, "")
    navigate(`/${base64Encode(props.directory)}/studio`)
  }

  const deleteSession = async (session: Session) => {
    const sessions = sessionList.filter((item) => !item.time?.archived)
    const index = sessions.findIndex((item) => item.id === session.id)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await globalSDK.createClient({ directory: props.directory }).session
      .delete({ sessionID: session.id })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    setSessionList(
      produce((draft) => {
        const index = draft.findIndex((item) => item.id === session.id)
        if (index !== -1) draft.splice(index, 1)
      }),
    )
    navigateAfterSessionRemoval(session.id, nextSession?.id)
    return true
  }

  function DialogDeleteSession(props: { session: Session }) {
    const name = createMemo(() => sessionTitle(props.session.title) ?? language.t("command.session.new"))
    const handleDelete = async () => {
      await deleteSession(props.session)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

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
                          <Show
                            when={title.editingID === session.id}
                            fallback={
                              <a
                                href={`/${base64Encode(props.directory)}/studio/${session.id}`}
                                class="flex items-center w-full rounded-[8px] transition-colors"
                                style={{ height: "36px", padding: "0 44px 0 44px", "font-size": "12px", "line-height": "20px", color: isActive() ? "#0A59F7" : undefined }}
                                classList={{
                                  "bg-[rgba(10,89,247,0.08)]": isActive(),
                                  "hover:bg-surface-base-hover": !isActive(),
                                }}
                              >
                                <span class="flex-1 min-w-0 truncate">
                                  {sessionTitle(session.title) ?? language.t("command.session.new")}
                                </span>
                              </a>
                            }
                          >
                            <div
                              class="flex items-center w-full rounded-[8px]"
                              style={{ height: "36px", padding: "0 44px 0 44px", "font-size": "12px", "line-height": "20px", color: isActive() ? "#0A59F7" : undefined, background: isActive() ? "rgba(10,89,247,0.08)" : undefined }}
                            >
                              <InlineInput
                                ref={(el) => {
                                  titleRef = el
                                }}
                                value={title.draft}
                                disabled={title.savingID === session.id}
                                class="text-[12px] leading-[20px] flex-1 min-w-0 rounded-[6px]"
                                onInput={(event) => setTitle("draft", event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  event.stopPropagation()
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    void saveTitleEditor(session)
                                    return
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault()
                                    closeTitleEditor()
                                  }
                                }}
                                onBlur={() => void saveTitleEditor(session)}
                              />
                            </div>
                          </Show>
                          <Show when={isActive() && title.editingID !== session.id}>
                            <span
                              class="absolute rounded-full pointer-events-none"
                              style={{
                                right: "4px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                width: "4px",
                                height: "28px",
                                background: "#0A59F7",
                              }}
                            />
                          </Show>
                          <DropdownMenu
                            gutter={4}
                            placement="bottom-end"
                            open={title.menuOpenID === session.id}
                            onOpenChange={(open) => setTitle("menuOpenID", open ? session.id : "")}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="dot-grid"
                              variant="ghost"
                              class="absolute right-[10px] top-1/2 -translate-y-1/2 size-6 rounded-md opacity-0 group-hover/item:opacity-100 data-[expanded]:opacity-100 data-[expanded]:bg-surface-base-active"
                              classList={{
                                "opacity-100 bg-surface-base-active": title.menuOpenID === session.id,
                              }}
                              aria-label={language.t("common.moreOptions")}
                              aria-expanded={title.menuOpenID === session.id}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                style={{ "min-width": "104px" }}
                                onCloseAutoFocus={(event) => {
                                  if (title.pendingRenameID !== session.id) return
                                  event.preventDefault()
                                  openTitleEditor(session)
                                }}
                              >
                                <DropdownMenu.Item
                                  onSelect={() => {
                                    setTitle({
                                      pendingRenameID: session.id,
                                      menuOpenID: "",
                                    })
                                  }}
                                >
                                  <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator />
                                <DropdownMenu.Item
                                  onSelect={() => dialog.show(() => <DialogDeleteSession session={session} />)}
                                >
                                  <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>
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
      <img src={IconHost} width={166} height={166} alt="" style={{ "flex-shrink": "0" }} />
      <div class="studio-intro-copy">
        <div class="studio-intro-title">Octo Studio</div>
        <div class="studio-intro-subtitle">一键创意落地，让视觉生产力触手可及</div>
      </div>
    </div>
  )
}

function StudioComposer(props: {
  prompt: string
  capability: StudioCapability
  styleModel: string
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  assets: StudioAsset[]
  videoFrames: { first?: StudioAsset; last?: StudioAsset }
  videoDuration: StudioVideoDuration
  videoQualityMode: StudioVideoQualityMode
  videoQualityLocked: boolean
  status: StudioGenerationStatus
  openMenu: "capability" | "style" | "settings" | "material" | null
  canSubmit: boolean
  wordBook: Resource<MaterialWordBook[]>
  onPrompt: (value: string) => void
  onCapability: (value: StudioCapability) => void
  onStyleModel: (value: string) => void
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onOpenMenu: (value: "capability" | "style" | "settings" | "material" | null) => void
  onVideoDuration: (value: StudioVideoDuration) => void
  onVideoQualityMode: (value: StudioVideoQualityMode) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onPickFile: () => void
  onPickVideoFrame: (slot: StudioVideoFrameSlot) => void
  onPasteImage: (files: File[]) => void
  onRemoveAsset: (id: string) => void
  onRemoveVideoFrame: (slot: StudioVideoFrameSlot) => void
  onSwapVideoFrames: () => void
}): JSX.Element {
  let pointerDownOpenMenu: typeof props.openMenu = null
  const referenceAsset = createMemo(() => props.assets[0])
  const isImageGeneration = createMemo(() => props.capability === "image.generate")
  const isVideoGeneration = createMemo(() => props.capability === "video.generate")
  const isEditingCapability = createMemo(() => Boolean(workspaceModeForCapability(props.capability)))

  function handlePaste(event: ClipboardEvent) {
    if (!isImageGeneration() && !isVideoGeneration()) return
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    props.onPasteImage(files)
  }

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!props.openMenu) return
    if (event.target instanceof Element && event.target.closest(".studio-menu")) return
    props.onOpenMenu(null)
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown)
  onCleanup(() => document.removeEventListener("pointerdown", handleDocumentPointerDown))

  return (
    <div class="studio-composer-wrap relative shrink-0">
      <div class="studio-composer" classList={{ video: isVideoGeneration() }}>
        <Show when={isVideoGeneration()}>
          <div class="studio-composer-video-frames">
            <VideoFrameButton
              label="首帧"
              asset={props.videoFrames.first}
              onPick={() => props.onPickVideoFrame("first")}
              onRemove={() => props.onRemoveVideoFrame("first")}
            />
            <button type="button" class="studio-composer-video-swap" onClick={props.onSwapVideoFrames} aria-label="交换首尾帧" title="交换首尾帧" />
            <VideoFrameButton
              label="尾帧"
              asset={props.videoFrames.last}
              onPick={() => props.onPickVideoFrame("last")}
              onRemove={() => props.onRemoveVideoFrame("last")}
            />
          </div>
        </Show>
        <div class="studio-composer-input-row" classList={{ "with-reference": isImageGeneration() }}>
          <Show when={isImageGeneration()}>
            <div class="studio-composer-ref-slot" classList={{ filled: Boolean(referenceAsset()) }}>
              <button
                type="button"
                onClick={props.onPickFile}
                class="studio-composer-ref-btn"
                title={referenceAsset() ? "替换参考图" : "上传参考图"}
              >
                <Show when={referenceAsset()}>
                  {(asset) => <img src={asset().dataUrl} alt={asset().name} class="studio-composer-ref-image" />}
                </Show>
              </button>
              <Show when={referenceAsset()}>
                {(asset) => (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onRemoveAsset(asset().id)
                    }}
                    class="studio-composer-ref-remove"
                    aria-label="删除参考图"
                    title="删除参考图"
                  >
                    ×
                  </button>
                )}
              </Show>
            </div>
          </Show>
          <textarea
            value={props.prompt}
            onInput={(event) => props.onPrompt(event.currentTarget.value)}
            onKeyDown={props.onKeyDown}
            onPaste={handlePaste}
            placeholder={isVideoGeneration() ? "请描述你想生成的视频内容，或使用反推描述图片，也可查看使用指南提升生成效果。" : "上传参考图、输入文字，描述你想生成的图片。"}
            class="studio-composer-input"
            disabled={isEditingCapability() || props.status === "running" || props.status === "submitting"}
          />
        </div>

        <div class="studio-composer-toolbar">
          <div class="relative">
            <Show when={props.openMenu === "capability"}>
              <CapabilityMenu value={props.capability} onSelect={(value) => { props.onCapability(value); props.onOpenMenu(null) }} />
            </Show>
            <ToolButton
              active={props.openMenu === "capability"}
              label={capabilityLabel(props.capability)}
              onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
              onClick={() => props.onOpenMenu(pointerDownOpenMenu === "capability" ? null : "capability")}
            />
          </div>
          <Show when={isImageGeneration()}>
            <div class="relative">
              <Show when={props.openMenu === "style"}>
                <StyleMenu value={props.styleModel} onSelect={(value) => { props.onStyleModel(value); props.onOpenMenu(null) }} />
              </Show>
              <ToolButton
                active={props.openMenu === "style"}
                label={styleModelLabel(props.styleModel)}
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "style" ? null : "style")}
              />
            </div>
            <div class="relative">
              <Show when={props.openMenu === "settings"}>
                <ImageSettings
                  aspectRatio={props.aspectRatio}
                  count={props.count}
                  onAspectRatio={props.onAspectRatio}
                  onCount={props.onCount}
                />
              </Show>
              <IconTool
                label="参数"
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "settings" ? null : "settings")}
              />
            </div>
            <div class="relative">
              <Show when={props.openMenu === "material"}>
                <MaterialMenu wordBook={props.wordBook} onSelectTag={(tag) => props.onPrompt(props.prompt ? props.prompt + "，" + tag : tag)} />
              </Show>
              <IconTool
                label="素材"
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "material" ? null : "material")}
              />
            </div>
          </Show>
          <Show when={isVideoGeneration()}>
            <div class="relative">
              <Show when={props.openMenu === "settings"}>
                <VideoSettings
                  aspectRatio={props.aspectRatio}
                  count={props.count}
                  duration={props.videoDuration}
                  qualityMode={props.videoQualityMode}
                  qualityLocked={props.videoQualityLocked}
                  onAspectRatio={props.onAspectRatio}
                  onCount={props.onCount}
                  onDuration={props.onVideoDuration}
                  onQualityMode={props.onVideoQualityMode}
                />
              </Show>
              <IconTool
                label="参数"
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "settings" ? null : "settings")}
              />
            </div>
          </Show>
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

function ToolButton(props: { label: string; active?: boolean; onClick: () => void; onPointerDown?: () => void }): JSX.Element {
  return (
    <button type="button" onPointerDown={props.onPointerDown} onClick={props.onClick} class="studio-composer-tool-btn" data-active={props.active || undefined}>
      <span class="studio-composer-tool-label">{props.label}</span>
      <span class="studio-composer-tool-caret" />
    </button>
  )
}

function IconTool(props: { label: string; onClick?: () => void; onPointerDown?: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onPointerDown={props.onPointerDown}
      onClick={props.onClick}
      class={`studio-composer-icon-tool ${props.label === "参数" ? "studio-composer-icon-settings" : "studio-composer-icon-material"}`}
      title={props.label}
      aria-label={props.label}
    />
  )
}

function VideoFrameButton(props: { label: string; asset?: StudioAsset; onPick: () => void; onRemove: () => void }): JSX.Element {
  return (
    <div class="studio-composer-video-frame-wrap">
      <button
        type="button"
        onClick={props.onPick}
        class="studio-composer-video-frame"
        classList={{ filled: Boolean(props.asset) }}
        title={props.asset ? `替换${props.label}` : `上传${props.label}`}
      >
        <Show when={props.asset} fallback={
          <>
            <span class="studio-composer-video-plus" />
            <span class="studio-composer-video-label">{props.label}</span>
          </>
        }>
          {(asset) => <img src={asset().dataUrl} alt={asset().name} class="studio-composer-video-image" />}
        </Show>
      </button>
      <Show when={props.asset}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            props.onRemove()
          }}
          class="studio-composer-video-remove"
          aria-label={`删除${props.label}`}
          title={`删除${props.label}`}
        >
          ×
        </button>
      </Show>
    </div>
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
    <div class="studio-menu studio-menu-model w-[414px] p-4">
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

function ImageSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
}): JSX.Element {
  return (
    <div class="studio-menu studio-image-settings-menu">
      <div class="studio-image-settings-title">图片设置</div>
      <div class="studio-image-settings-label">选择比例</div>
      <div class="studio-image-settings-ratios">
        <For each={STUDIO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="studio-image-settings-ratio"
              classList={{ active: item === props.aspectRatio }}
              aria-pressed={item === props.aspectRatio}
            >
              <span
                class="studio-image-settings-ratio-icon"
                style={{
                  "aspect-ratio": item.replace(":", " / "),
                  width: item === "1:1" ? "22px" : item === "2:3" || item === "3:4" || item === "9:16" ? "14px" : "28px",
                }}
              />
              <span class="studio-image-settings-ratio-text">{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">图片数量</div>
      <div class="studio-image-settings-counts">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.count }}
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

function VideoSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  duration: StudioVideoDuration
  qualityMode: StudioVideoQualityMode
  qualityLocked: boolean
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onDuration: (value: StudioVideoDuration) => void
  onQualityMode: (value: StudioVideoQualityMode) => void
}): JSX.Element {
  return (
    <div class="studio-menu studio-image-settings-menu studio-video-settings-menu">
      <div class="studio-image-settings-title">视频设置</div>
      <div class="studio-image-settings-label">选择比例</div>
      <div class="studio-image-settings-ratios studio-video-settings-ratios">
        <For each={STUDIO_VIDEO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="studio-image-settings-ratio"
              classList={{ active: item === props.aspectRatio }}
              aria-pressed={item === props.aspectRatio}
            >
              <span
                class="studio-image-settings-ratio-icon"
                style={{
                  "aspect-ratio": item.replace(":", " / "),
                  width: item === "1:1" ? "22px" : item === "9:16" ? "14px" : "28px",
                }}
              />
              <span class="studio-image-settings-ratio-text">{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">视频时长</div>
      <div class="studio-image-settings-counts studio-video-settings-duration">
        <For each={["5", "10"] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onDuration(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.duration }}
              aria-pressed={item === props.duration}
            >
              {item}秒
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">视频数量</div>
      <div class="studio-image-settings-counts studio-video-settings-count">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.count }}
              aria-pressed={item === props.count}
            >
              {item}个
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">生成模式</div>
      <div class="studio-image-settings-counts studio-video-settings-quality">
        <For each={[
          { label: "标准", value: "std" },
          { label: "高质量", value: "pro" },
        ] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onQualityMode(item.value)}
              disabled={props.qualityLocked}
              class="studio-image-settings-count"
              classList={{ active: item.value === props.qualityMode }}
              aria-pressed={item.value === props.qualityMode}
            >
              {item.label}
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
  onSelectImage: (input: { resultID: string; imageID: string }) => void
  onOpenEditor: (capability: StudioCapability) => void
}): JSX.Element {
  return (
    <div class="studio-conversation">
      <For each={props.turns}>
        {(turn, index) => (
          <div class="studio-conversation-turn" classList={{ separated: index() > 0 }}>
            <div class="studio-user-bubble">
              {turn.userText || props.result?.prompt?.split("\n")[0] || "Octo Studio"}
            </div>
            <Show when={turn.editCapability} fallback={
              <Show when={sanitizeStudioAssistantText(turn.assistantText)}>
                {(assistantText) => <div class="studio-assistant-copy">{assistantText()}</div>}
              </Show>
            }>
              {(editCapability) => (
                <button
                  type="button"
                  class="studio-assistant-editor-link"
                  onClick={() => props.onOpenEditor(editCapability())}
                >
                  点击前往编辑区
                </button>
              )}
            </Show>
            <Show when={!turn.editCapability}>
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
                <div class="studio-result-title">{turn.toolTitle ?? studioGenerationTitle(turn.result?.capability ?? props.result?.capability, turn.result?.images.length ? "succeeded" : "running")}</div>
                <div class="studio-result-meta">
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
                        <button
                          type="button"
                          onClick={() => turn.result && props.onSelectImage({ resultID: turn.result.id, imageID: image.id })}
                          class="studio-result-thumb"
                        >
                          <StudioMediaPreview image={image} class="studio-result-thumb-media" />
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
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

function sanitizeStudioAssistantText(text?: string) {
  return text
    ?.split("\n")
    .filter((line) => !line.includes("当前选中的生图工具") && !line.includes("内部模型"))
    .join("\n")
    .trim()
}

function StudioMediaPreview(props: { image: StudioImage; class?: string; controls?: boolean }): JSX.Element {
  return (
    <Show when={isVideoMedia(props.image)} fallback={
      <img src={props.image.thumbnailUrl ?? props.image.url} class={props.class} alt="" />
    }>
      <video
        src={props.image.remoteUrl ?? props.image.url}
        class={props.class}
        controls={props.controls}
        muted={!props.controls}
        playsinline
        preload="metadata"
      />
    </Show>
  )
}

function StudioResultCanvas(props: {
  status: StudioGenerationStatus
  image?: StudioImage
  result?: StudioGenerationResult
  imageLabel: string
  onDownload: () => void
}): JSX.Element {
  return (
    <Show when={props.image} fallback={
      <div class="h-full flex flex-col items-center justify-center text-center">
        <Show when={props.status === "running" || props.status === "submitting"} fallback={
          <Show when={props.status === "failed" && props.result?.error} fallback={
          <>
            <img src={IllustrationInsightEmpty} width={210} height={210} alt="" aria-hidden="true" />
            <div class="absolute bottom-[130px] text-[14px] font-bold">生成中...</div>
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
          <img src={IllustrationInsightEmpty} width={210} height={210} alt="" aria-hidden="true" />
          <div class="absolute bottom-[130px] text-[14px] font-bold">生成中...</div>
        </Show>
      </div>
    }>
      {(image) => (
        <>
          <div class="studio-canvas-header">
            <span class="studio-canvas-label">
              <span class="studio-canvas-label-text">{props.imageLabel}</span>
            </span>
          </div>
          <div class="studio-canvas-stage">
            <StudioMediaPreview image={image()} class="studio-canvas-image" controls={isVideoMedia(image())} />
          </div>
          <div class="studio-canvas-floating-actions">
            <button type="button" onClick={props.onDownload} class="studio-canvas-download-action" title="下载">下载</button>
          </div>
        </>
      )}
    </Show>
  )
}

function StudioWorkspaceUpload(props: { onUpload: (files: File[]) => void }): JSX.Element {
  let inputRef!: HTMLInputElement

  return (
    <div
      class="studio-workspace-upload"
      onClick={() => inputRef.click()}
      onDragOver={(event) => {
        event.preventDefault()
        event.currentTarget.classList.add("dragging")
      }}
      onDragLeave={(event) => {
        event.currentTarget.classList.remove("dragging")
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.currentTarget.classList.remove("dragging")
        props.onUpload(Array.from(event.dataTransfer?.files ?? []))
      }}
    >
      <div class="studio-workspace-upload-target">
        <span class="studio-workspace-upload-plus" />
        <span class="studio-workspace-upload-title">上传图片</span>
        <span class="studio-workspace-upload-copy">本地上传/拖拽图片上传</span>
      </div>
      <input
        ref={inputRef!}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={(event) => {
          if (event.currentTarget.files?.length) props.onUpload(Array.from(event.currentTarget.files))
          event.currentTarget.value = ""
        }}
      />
    </div>
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
  onInpaint: () => void
  onOutpaint: () => void
}): JSX.Element {
  const isEditResult = createMemo(() => isStudioEditResult(props.result))
  const isVideoResult = createMemo(() => props.result.capability === "video.generate" || isVideoMedia(props.image))
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
              <StudioMediaPreview image={image} class="studio-detail-preview-image" />
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
        <Show when={isVideoResult()}>
          <InfoRow label="类型" value={props.result.videoMode === "first_last_frame" ? "首尾帧生成" : "文生视频"} />
          <InfoRow label="时长" value={props.result.duration ? `${props.result.duration}秒` : "-"} />
        </Show>
        <Show when={!isVideoResult()}>
          <InfoRow label="分辨率" value={props.image?.width && props.image.height ? `${props.image.width} x ${props.image.height}` : "-"} />
        </Show>
        <InfoRow label="数量" value={`${props.result.images.length}`} />
        <InfoRow label="当前" value={`${Math.max(props.result.images.findIndex((item) => item.id === (props.selectedImageId ?? props.result.images[0]?.id)) + 1, 1)}/${props.result.images.length}`} />
      </section>
      <section class="studio-detail-section">
        <Show when={!isEditResult()}>
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
        </Show>
        <Show when={!isVideoResult()}>
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
            <button
              type="button"
              onClick={props.onInpaint}
              disabled={props.regenerateDisabled}
              class="studio-details-secondary-action studio-detail-action-inpaint disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <span>智能重绘</span>
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
        </Show>
      </section>
    </ScrollView>
  )
}

function StudioHDEditor(props: {
  image: StudioImage
  onClose: () => void
  onDelete: () => void
  onSubmit: (input: { mode: StudioHDMode }) => void
}): JSX.Element {
  const [selectedMode, setSelectedMode] = createSignal<StudioHDMode>("restoration_8k")
  const [loadError, setLoadError] = createSignal("")

  createEffect(
    on(
      () => props.image.id,
      () => {
        setLoadError("")
        setSelectedMode("restoration_8k")
      },
    ),
  )

  return (
    <div class="studio-hd">
      <div class="studio-hd-header">
        <div class="min-w-0">
          <div class="studio-hd-title">变清晰</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-hd-close" aria-label="关闭变清晰" title="关闭变清晰" />
      </div>
      <div class="studio-hd-body">
        <div class="studio-hd-canvas-wrap">
          <img
            class="studio-hd-image"
            src={props.image.url}
            alt="HD source"
            onLoad={() => setLoadError("")}
            onError={() => setLoadError("图片加载失败")}
          />
          <Show when={loadError()}>
            {(message) => <div class="studio-hd-loading">{message()}</div>}
          </Show>
        </div>
        <div class="studio-hd-controls">
          <div class="studio-hd-mode-group" aria-label="放大模式">
            <span class="studio-hd-mode-label">放大模式</span>
            <For each={STUDIO_HD_MODES}>
              {(option) => (
                <button
                  type="button"
                  class="studio-hd-mode-option"
                  classList={{ active: selectedMode() === option.value }}
                  aria-pressed={selectedMode() === option.value}
                  data-mode={option.value}
                  onClick={() => setSelectedMode(option.value)}
                >
                  <span class="studio-hd-mode-dot" />
                  <span class="studio-hd-mode-text">{option.label}</span>
                </button>
              )}
            </For>
          </div>
          <div class="studio-editor-actions">
            <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
            <button
              type="button"
              class="studio-hd-create"
              onClick={() => props.onSubmit({ mode: selectedMode() })}
            >
              一键生成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StudioCutoutEditor(props: {
  image: StudioImage
  busy: boolean
  onClose: () => void
  onDelete: () => void
  onSubmit: () => void
}): JSX.Element {
  const [loadError, setLoadError] = createSignal("")

  createEffect(
    on(
      () => props.image.id,
      () => setLoadError(""),
    ),
  )

  return (
    <div class="studio-cutout">
      <div class="studio-cutout-header">
        <div class="min-w-0">
          <div class="studio-cutout-title">抠图</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-cutout-close" aria-label="关闭抠图" title="关闭抠图" />
      </div>
      <div class="studio-cutout-body">
        <div class="studio-cutout-canvas-wrap">
          <img
            class="studio-cutout-image"
            src={props.image.url}
            alt="Cutout source"
            onLoad={() => setLoadError("")}
            onError={() => setLoadError("图片加载失败")}
          />
          <Show when={loadError()}>
            {(message) => <div class="studio-cutout-loading">{message()}</div>}
          </Show>
        </div>
        <div class="studio-cutout-controls">
          <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
          <button
            type="button"
            class="studio-hd-create"
            disabled={props.busy}
            onClick={props.onSubmit}
          >
            一键生成
          </button>
        </div>
      </div>
    </div>
  )
}

function StudioInpaintEditor(props: {
  image: StudioImage
  busy: boolean
  onClose: () => void
  onDelete: () => void
  onSubmit: (input: {
    prompt: string
    mode: StudioInpaintMode
    sourceImage: string
    compositeImage: string
    hasDrawing: boolean
  }) => void
}): JSX.Element {
  const [editMode, setEditMode] = createSignal<StudioInpaintMode>("qwen_image_edit")
  const [brushSize, setBrushSize] = createSignal(40)
  const [editorPrompt, setEditorPrompt] = createSignal("")
  const [sourceSize, setSourceSize] = createSignal({ width: props.image.width ?? 0, height: props.image.height ?? 0 })
  const [displaySize, setDisplaySize] = createSignal({ width: 0, height: 0 })
  const [undoList, setUndoList] = createSignal<string[]>([])
  const [redoList, setRedoList] = createSignal<string[]>([])
  const [hasDrawing, setHasDrawing] = createSignal(false)
  const [loadError, setLoadError] = createSignal("")
  const [cursor, setCursor] = createSignal({ x: 0, y: 0, visible: false })
  const sourceMaskCanvas = document.createElement("canvas")
  let sourceImage: HTMLImageElement | undefined
  let canvasWrapRef!: HTMLDivElement
  let maskCanvasRef!: HTMLCanvasElement
  let drawing = false
  let lastPoint: { x: number; y: number } | undefined

  function renderMaskPreview() {
    const context = maskCanvasRef?.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, displaySize().width, displaySize().height)
    if (!sourceMaskCanvas.width || !sourceMaskCanvas.height) return
    context.drawImage(sourceMaskCanvas, 0, 0, displaySize().width, displaySize().height)
  }

  function resetMaskCanvas(width: number, height: number) {
    sourceMaskCanvas.width = width
    sourceMaskCanvas.height = height
    const initialState = sourceMaskCanvas.toDataURL("image/png")
    setUndoList([initialState])
    setRedoList([])
    setHasDrawing(false)
    renderMaskPreview()
  }

  function updateHasDrawing() {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context || !sourceMaskCanvas.width || !sourceMaskCanvas.height) {
      setHasDrawing(false)
      return false
    }
    const pixels = context.getImageData(0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height).data
    const nextHasDrawing = pixels.some((value, index) => index % 4 === 3 && value > 0)
    setHasDrawing(nextHasDrawing)
    return nextHasDrawing
  }

  function restoreMaskState(state: string) {
    const image = new Image()
    image.onload = () => {
      const context = sourceMaskCanvas.getContext("2d")
      if (!context) return
      context.clearRect(0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height)
      context.drawImage(image, 0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height)
      updateHasDrawing()
      renderMaskPreview()
    }
    image.src = state
  }

  function updateDisplaySize() {
    const width = sourceSize().width
    const height = sourceSize().height
    if (!canvasWrapRef || !width || !height) return
    const rect = canvasWrapRef.getBoundingClientRect()
    const scale = Math.min(
      Math.max(1, rect.width - 48) / width,
      Math.max(1, rect.height - 48) / height,
      1,
    )
    setDisplaySize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    })
  }

  createEffect(
    on(
      () => `${props.image.id}:${props.image.url}`,
      () => {
        setLoadError("")
        setEditorPrompt("")
        setEditMode("qwen_image_edit")
        const image = new Image()
        if (/^https?:\/\//i.test(props.image.url)) image.crossOrigin = "anonymous"
        image.onload = () => {
          sourceImage = image
          setSourceSize({ width: image.naturalWidth, height: image.naturalHeight })
          resetMaskCanvas(image.naturalWidth, image.naturalHeight)
          requestAnimationFrame(updateDisplaySize)
        }
        image.onerror = () => setLoadError("图片加载失败")
        image.src = props.image.url
      },
    ),
  )

  createEffect(() => {
    const observer = new ResizeObserver(() => updateDisplaySize())
    observer.observe(canvasWrapRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    displaySize()
    requestAnimationFrame(renderMaskPreview)
  })

  function toSourcePoint(event: PointerEvent) {
    const rect = maskCanvasRef.getBoundingClientRect()
    return {
      x: clamp((event.clientX - rect.left) / rect.width * sourceMaskCanvas.width, 0, sourceMaskCanvas.width),
      y: clamp((event.clientY - rect.top) / rect.height * sourceMaskCanvas.height, 0, sourceMaskCanvas.height),
    }
  }

  function updateCursor(event: PointerEvent, visible: boolean) {
    const rect = maskCanvasRef.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    setCursor({
      x,
      y,
      visible: visible && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height,
    })
  }

  function drawDot(point: { x: number; y: number }) {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context) return
    const scale = displaySize().width / sourceMaskCanvas.width
    context.fillStyle = "rgba(137, 71, 213, 0.3)"
    context.beginPath()
    context.arc(point.x, point.y, brushSize() / Math.max(scale, 0.001) / 2, 0, Math.PI * 2)
    context.fill()
  }

  function drawLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context) return
    const scale = displaySize().width / sourceMaskCanvas.width
    context.strokeStyle = "rgba(137, 71, 213, 0.3)"
    context.lineCap = "round"
    context.lineJoin = "round"
    context.lineWidth = brushSize() / Math.max(scale, 0.001)
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }

  function finishDrawing() {
    if (!drawing) return
    drawing = false
    lastPoint = undefined
    const nextState = sourceMaskCanvas.toDataURL("image/png")
    setUndoList((items) => [...items, nextState])
    setRedoList([])
    updateHasDrawing()
    renderMaskPreview()
  }

  function clearMask() {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height)
    const initialState = sourceMaskCanvas.toDataURL("image/png")
    setUndoList([initialState])
    setRedoList([])
    setHasDrawing(false)
    renderMaskPreview()
  }

  function undoMask() {
    const current = undoList().at(-1)
    const previous = undoList().at(-2)
    if (!current || !previous) return
    setUndoList((items) => items.slice(0, -1))
    setRedoList((items) => [...items, current])
    restoreMaskState(previous)
  }

  function redoMask() {
    const next = redoList().at(-1)
    if (!next) return
    setRedoList((items) => items.slice(0, -1))
    setUndoList((items) => [...items, next])
    restoreMaskState(next)
  }

  function handlePointerDown(event: PointerEvent) {
    if (!sourceMaskCanvas.width || !sourceMaskCanvas.height || props.busy) return
    event.preventDefault()
    maskCanvasRef.setPointerCapture(event.pointerId)
    drawing = true
    lastPoint = toSourcePoint(event)
    drawDot(lastPoint)
    updateCursor(event, true)
    renderMaskPreview()
  }

  function handlePointerMove(event: PointerEvent) {
    updateCursor(event, true)
    if (!drawing || !lastPoint) return
    const nextPoint = toSourcePoint(event)
    drawLine(lastPoint, nextPoint)
    lastPoint = nextPoint
    renderMaskPreview()
  }

  function handlePointerUp(event: PointerEvent) {
    updateCursor(event, true)
    if (maskCanvasRef.hasPointerCapture(event.pointerId)) maskCanvasRef.releasePointerCapture(event.pointerId)
    finishDrawing()
  }

  function createCompositeImage() {
    if (!sourceImage) throw new Error("图片尚未加载完成")
    const canvas = document.createElement("canvas")
    canvas.width = sourceSize().width
    canvas.height = sourceSize().height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法创建智能重绘画布")
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)
    context.drawImage(sourceMaskCanvas, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/png").split(",")[1] ?? ""
  }

  function submit() {
    const nextHasDrawing = updateHasDrawing()
    if (!nextHasDrawing || props.busy) return
    try {
      props.onSubmit({
        prompt: editorPrompt().trim(),
        mode: editMode(),
        sourceImage: props.image.remoteUrl ?? props.image.url,
        compositeImage: createCompositeImage(),
        hasDrawing: nextHasDrawing,
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const promptPlaceholder = createMemo(() =>
    editMode() === "erase"
      ? "请输入想要消除的物体，可留空"
      : hasDrawing()
        ? "重绘所选区域：例如把花瓶改成台灯"
        : "涂抹要修改的区域，并描述希望变成什么",
  )

  return (
    <div class="studio-inpaint">
      <div class="studio-inpaint-header">
        <div class="min-w-0">
          <div class="studio-inpaint-title">智能重绘</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-inpaint-close" aria-label="关闭智能重绘" title="关闭智能重绘" />
      </div>
      <div class="studio-inpaint-body">
        <div ref={canvasWrapRef!} class="studio-inpaint-canvas-wrap">
          <Show when={displaySize().width && displaySize().height} fallback={
            <div class="studio-inpaint-loading">{loadError() || "图片加载中..."}</div>
          }>
            <div
              class="studio-inpaint-stage"
              style={{ width: `${displaySize().width}px`, height: `${displaySize().height}px` }}
            >
              <img
                src={props.image.url}
                class="studio-inpaint-image"
                alt="Inpaint source"
                draggable={false}
              />
              <canvas
                ref={maskCanvasRef!}
                class="studio-inpaint-mask"
                width={displaySize().width}
                height={displaySize().height}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={(event) => {
                  updateCursor(event, false)
                  finishDrawing()
                }}
              />
              <Show when={cursor().visible}>
                <span
                  class="studio-inpaint-cursor"
                  style={{
                    left: `${cursor().x}px`,
                    top: `${cursor().y}px`,
                    width: `${brushSize()}px`,
                    height: `${brushSize()}px`,
                  }}
                />
              </Show>
            </div>
          </Show>
          <Show when={loadError()}>
            {(message) => <div class="studio-inpaint-error">{message()}</div>}
          </Show>
        </div>
        <div class="studio-inpaint-controls">
          <div class="studio-inpaint-toolbar">
            <div class="studio-inpaint-mode-group" aria-label="生成模式">
              <span class="studio-inpaint-mode-label">生成模式</span>
              <For each={[
                { label: "重绘", value: "qwen_image_edit" },
                { label: "消除", value: "erase" },
              ] as const}>
                {(option) => (
                  <button
                    type="button"
                    class="studio-inpaint-mode-option"
                    classList={{ active: editMode() === option.value }}
                    aria-pressed={editMode() === option.value}
                    onClick={() => setEditMode(option.value)}
                  >
                    <span class="studio-inpaint-mode-dot" />
                    <span class="studio-inpaint-mode-text">{option.label}</span>
                  </button>
                )}
              </For>
            </div>
            <div class="studio-inpaint-tool-group">
              <div class="studio-inpaint-tool-row">
                <button
                  type="button"
                  onClick={clearMask}
                  disabled={!hasDrawing() || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-clean"
                  aria-label="清空"
                  title="清空"
                />
                <button
                  type="button"
                  onClick={undoMask}
                  disabled={undoList().length < 2 || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-undo"
                  aria-label="撤销"
                  title="撤销"
                />
                <button
                  type="button"
                  onClick={redoMask}
                  disabled={redoList().length === 0 || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-redo"
                  aria-label="重做"
                  title="重做"
                />
              </div>
              <label class="studio-inpaint-brush">
                <span>笔刷粗细</span>
                <strong>{brushSize()}</strong>
                <input
                  type="range"
                  min="10"
                  max="126"
                  value={brushSize()}
                  onInput={(event) => setBrushSize(Number(event.currentTarget.value))}
                />
              </label>
            </div>
          </div>
          <div class="studio-inpaint-prompt-row">
            <textarea
              class="studio-inpaint-prompt"
              maxlength="2000"
              placeholder={promptPlaceholder()}
              value={editorPrompt()}
              disabled={props.busy}
              onInput={(event) => setEditorPrompt(event.currentTarget.value)}
            />
            <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
            <button
              type="button"
              disabled={!hasDrawing() || props.busy}
              onClick={submit}
              class="studio-hd-create"
            >
              一键生成
            </button>
          </div>
        </div>
      </div>
    </div>
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
  onDelete: () => void
  onSubmit: (input: { prompt: string; extra: Record<string, unknown> }) => void
}): JSX.Element {
  const [editorPrompt, setEditorPrompt] = createSignal("")
  const [stage, setStage] = createSignal({ width: 828, height: 420 })
  const [rect, setRect] = createSignal<OutpaintBox>()
  const [imageSourceSize, setImageSourceSize] = createSignal({ width: props.image.width ?? 1024, height: props.image.height ?? 1024 })
  const ratios = ["1:1", "9:16", "16:9"] as StudioAspectRatio[]
  let stageRef!: HTMLDivElement

  createEffect(
    on(
      () => `${props.image.id}:${props.image.url}:${props.image.width ?? ""}:${props.image.height ?? ""}`,
      () => {
        if (props.image.width && props.image.height) {
          setImageSourceSize({ width: props.image.width, height: props.image.height })
          return
        }
        const image = new Image()
        image.onload = () => setImageSourceSize({ width: image.naturalWidth, height: image.naturalHeight })
        image.src = props.image.url
      },
    ),
  )

  const imageBox = createMemo<OutpaintBox>(() => {
    const sourceWidth = imageSourceSize().width
    const sourceHeight = imageSourceSize().height
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
      () => `${props.image.id}:${stage().width}:${stage().height}:${imageSourceSize().width}:${imageSourceSize().height}`,
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
    const scale = imageBox().width / imageSourceSize().width
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
          <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
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
            class="studio-hd-create disabled:opacity-45"
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
