import "./studio/studio.css"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { tracker } from "@/utils/tracker"
import { batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import { useProjectDir } from "@/hooks/use-project-dir"
import { sessionTitle } from "@/utils/session-title"
import { authTokenFromCredentials } from "@/utils/server"
import { useServer } from "@/context/server"
import {
  STUDIO_ASPECT_RATIOS,
  capabilityLabel,
  styleModelLabel,
  styleModelRequiresSeedreamPermission,
} from "./studio/data"
import type {
  StudioAsset,
  StudioAspectRatio,
  StudioCapability,
  StudioGenerationResult,
  StudioGenerationStatus,
  StudioImage,
  StudioImageTool,
  StudioMode,
} from "./studio/types"
import {
  buildStudioConversationContext,
  buildStudioDisplayPrompt,
  buildStudioTurns,
  type StudioTurnData,
} from "./studio/turns"
import { StudioHistory } from "./studio/studio-history"
import { StudioComposer, StudioIntro } from "./studio/studio-composer"
import { StudioConversation, StudioDetails, StudioEmptyState, StudioResultCanvas, StudioWorkspaceUpload } from "./studio/studio-conversation"
import { StudioCutoutEditor, StudioHDEditor } from "./studio/studio-editors-basic"
import { StudioInpaintEditor } from "./studio/studio-inpaint-editor"
import { StudioOutpaintEditor } from "./studio/studio-outpaint-editor"
import { StudioVideoRiskDialog } from "./studio/studio-video-risk-dialog"
import type { MaterialWordBook } from "./studio/MaterialMenu"
import {
  createBlobUrlFromDataUrl,
  formatStudioGenerationError,
  hasVideoFrameAssets,
  isVideoMedia,
  isStudioGenerationFailure,
  isStudioGenerationStatusRegression,
  recordValue,
  STUDIO_GENERATION_CANCEL_TIMEOUT_MS,
  STUDIO_GENERATION_CREATE_TIMEOUT_MS,
  STUDIO_GENERATION_STATUS_INTERVAL_MS,
  STUDIO_VIDEO_ASPECT_RATIOS,
  stringValue,
  studioGenerationTitle,
  SUPPORTED_STUDIO_CAPABILITIES,
  triggerBrowserDownload,
  uiplusUserAccount,
  workspaceModeForCapability,
  type StudioHDMode,
  type StudioInpaintMode,
  type StudioPendingResult,
  type StudioVideoDuration,
  type StudioVideoFrameSlot,
  type StudioVideoQualityMode,
} from "./studio/studio-shared"
import { createStudioSessionData } from "./studio/studio-session-data"

type StudioEditorCapability = "image.upscale" | "image.cutout" | "image.inpaint" | "image.outpaint"
type StudioGenerationOverrides = {
  capability?: StudioCapability
  prompt?: string
  sourceImage?: string
  referenceImages?: string[]
  extra?: Record<string, unknown>
  videoFrames?: { first?: string; last?: string }
  styleModel?: string
  aspectRatio?: StudioAspectRatio
  count?: 1 | 2 | 3 | 4
  videoDuration?: StudioVideoDuration
  videoQualityMode?: StudioVideoQualityMode
  useRestoredInputs?: boolean
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
  let studioPermissionChecked = false
  let studioPageRef!: HTMLDivElement

  onMount(() => { tracker.page({ module: "studio", name: "studio-page" }) })

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
  const routeSlug = createMemo(() => params.dir && decode64(params.dir) ? params.dir : slug())

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

  // 进入 studio 页面且没有指定 session 时，恢复上一次选中的 session
  createEffect(() => {
    if (params.id) return
    if (new URLSearchParams(location.search).has("hint")) return
    const decoded = decode64(params.dir)
    if (!decoded) return
    const lastId = layout.lastSessionPerTab.studio(decoded)
    if (!lastId || !isValidStudioSession(lastId)) return
    navigate(`/${routeSlug()}/studio/${lastId}`, { replace: true })
  })

  const [prompt, setPrompt] = createSignal("")
  const [capability, setCapability] = createSignal<StudioCapability>("image.generate")
  const [styleModel, setStyleModel] = createSignal("seedream-5-lite")
  const [aspectRatio, setAspectRatio] = createSignal<StudioAspectRatio>("3:4")
  const [count, setCount] = createSignal<1 | 2 | 3 | 4>(1)
  const [imageTool, setImageTool] = createSignal<StudioImageTool>("internel")
  const [imageSettingStore, setImageSettingStore] = persisted(
    Persist.global("studio.image.settings"),
    createStore({ aspectRatio: "3:4" as StudioAspectRatio, count: 1 as 1 | 2 | 3 | 4 }),
  )
  const [assets, setAssets] = createSignal<StudioAsset[]>([])
  const [videoFrames, setVideoFrames] = createStore<{ first?: StudioAsset; last?: StudioAsset }>({})
  const [videoDuration, setVideoDuration] = createSignal<StudioVideoDuration>("5")
  const [videoQualityMode, setVideoQualityMode] = createSignal<StudioVideoQualityMode>("std")
  const [status, setStatus] = createSignal<StudioGenerationStatus>("idle")
  const [pendingResult, setPendingResult] = createSignal<StudioPendingResult>()
  const [cancellingGenerationIDs, setCancellingGenerationIDs] = createSignal<ReadonlySet<string>>(new Set())
  const [selectedResultId, setSelectedResultId] = createSignal<string>()
  const [selectedImageId, setSelectedImageId] = createSignal<string>()
  const [deletedImageIds, setDeletedImageIds] = createSignal<Set<string>>(new Set())
  const processedAutoAddResults = new Set<string>()
  const [showStudioCanvas, setShowStudioCanvas] = createSignal(false)
  const [canvasTabImages, setCanvasTabImages] = createSignal<StudioImage[]>([])
  const [canvasTabLabels, setCanvasTabLabels] = createSignal<Record<string, string>>({})
  const [workspaceImage, setWorkspaceImage] = createSignal<StudioImage>()
  const [workspaceUploadRequested, setWorkspaceUploadRequested] = createSignal(false)
  const [pendingEditorEntries, setPendingEditorEntries] = createSignal<StudioTurnData[]>([])
  const [openMenu, setOpenMenu] = createSignal<"capability" | "style" | "settings" | "material" | null>(null)
  const [canGenerateVideo, setCanGenerateVideo] = createSignal(false)
  const [canUseSeedream, setCanUseSeedream] = createSignal(false)
  const [studioPermissionReady, setStudioPermissionReady] = createSignal(false)
  const [videoRiskDialogOpen, setVideoRiskDialogOpen] = createSignal(false)
  const [videoRiskConfirmedSessionID, setVideoRiskConfirmedSessionID] = createSignal<string>()
  const [draftVideoRiskConfirmed, setDraftVideoRiskConfirmed] = createSignal(false)
  const [wordBook] = createResource(
    () => server.current,
    async (current: any) => {
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
  createEffect(() => {
    const current = server.current
    if (!current || studioPermissionChecked) return
    studioPermissionChecked = true
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-opencode-directory": projectDir(),
    }
    if (current.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    void fetch(new URL("/studio/permissions/check", current.http.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ uid: uiplusUserAccount() }),
    })
      .then(async (response) => {
        const bodyText = await response.text()
        if (!response.ok) throw new Error(`check_permission failed: ${response.status} ${bodyText}`)
        const result = JSON.parse(bodyText) as { code?: number; resp_code?: number; data?: unknown }
        const permissionData = Array.isArray(result.data) ? result.data : []
        const permissionOk = result.code === 200 || result.resp_code === 200
        setCanGenerateVideo(permissionOk && permissionData[0] === true)
        setCanUseSeedream(permissionOk && permissionData[1] === true)
        setStudioPermissionReady(true)
      })
      .catch((error) => {
        setCanGenerateVideo(false)
        setCanUseSeedream(false)
        setStudioPermissionReady(true)
        console.error("[StudioPage] permission check failed", error)
      })
  })
  createEffect(() => {
    if (!studioPermissionReady()) return
    if (canUseSeedream() || !styleModelRequiresSeedreamPermission(styleModel())) return
    setStyleModel("qwen")
  })
  const [mode, setMode] = createSignal<StudioMode>("preview")
  const [sending, setSending] = createSignal(false)
  let generationToken = 0
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
  const { dataStore, loadSessionMessages, sessionStatus } = createStudioSessionData({
    sessionID: () => params.id,
    globalSDK,
  })
  let fileInputRef!: HTMLInputElement
  let videoFrameInputRef!: HTMLInputElement
  let pendingVideoFrameSlot: StudioVideoFrameSlot = "first"
  let conversationScrollRef!: HTMLDivElement
  let scrollFrame = 0
  let pendingEditorSessionID: string | undefined
  let pendingGenerationSessionID: string | undefined
  let pendingVideoFirstFrame: StudioAsset | undefined
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
      setStudioCenterWidth(Math.min(700, Math.max(468, startWidth + delta)))
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const isBusy = createMemo(() =>
    sending() ||
    sessionStatus().type === "busy" ||
    pendingResult()?.status === "queued" ||
    pendingResult()?.status === "running"
  )
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
          toolTitle: studioGenerationTitle(pending.capability, isStudioGenerationFailure(pending.status) ? pending.status : pending.status === "succeeded" ? "succeeded" : "running"),
          toolName: `内部 · ${pending.status === "create_failed" ? "创建失败" : pending.status === "failed" ? "失败" : pending.status === "succeeded" ? "完成" : "生成中"}`,
          toolRunning: pending.status === "running",
          result: normalizeResultValue(pending),
        }
      })
      const mergeEditorEntries = (items: StudioTurnData[]) => {
        const persisted = new Set(items.map((turn) => turn.editorEntryID).filter((id): id is string => Boolean(id)))
        return [
          ...items,
          ...pendingEditorEntries().filter((turn) => !persisted.has(turn.editorEntryID!)),
        ]
          .sort((left, right) => left.createdAt - right.createdAt)
          .map((turn, index, all) => ({ ...turn, isLatest: index === all.length - 1 }))
      }
      if (!pending) return mergeEditorEntries(next)
      const latest = next.at(-1)
      if (latest?.userText === pending.prompt && !latest.result?.images.length && latest.toolRunning) {
        if (isStudioGenerationFailure(pending.status)) {
          return mergeEditorEntries([
            ...next.slice(0, -1),
            {
              ...latest,
              toolTitle: studioGenerationTitle(pending.capability, pending.status),
              toolName: pending.status === "create_failed" ? "内部 · 创建失败" : "内部 · 失败",
              toolRunning: false,
              result: normalizeResultValue(pending),
            },
          ])
        }
        if (pending.status !== "succeeded" || pending.images.length === 0) return mergeEditorEntries(next)
        return mergeEditorEntries([
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
        ])
      }
      if (!sending() && !isStudioGenerationFailure(pending.status) && next.length > 0) return mergeEditorEntries(next)
      if ([pending.id, pendingTurnID].includes(next.at(-1)?.id)) return mergeEditorEntries(next)
      return mergeEditorEntries([
        ...next,
        {
          id: pending.id,
          userText: pending.prompt,
          assistantText: buildStudioThinkingText({
            text: pending.prompt,
            capability: pending.capability,
            sourceImage: pending.sourceImage,
          }),
          toolTitle: studioGenerationTitle(pending.capability, isStudioGenerationFailure(pending.status) ? pending.status : "running"),
          toolName: `内部 · ${pending.status === "create_failed" ? "创建失败" : pending.status === "failed" ? "失败" : "生成中"}`,
          result: normalizeResultValue(pending),
          createdAt: pending.createdAt,
          isLatest: true,
        } satisfies StudioTurnData,
      ])
    })(),
  )
  createEffect(() => {
    const persisted = new Set(turns().map((turn) => turn.editorEntryID).filter((id): id is string => Boolean(id)))
    if (persisted.size === 0) return
    setPendingEditorEntries((entries) => entries.filter((entry) => !persisted.has(entry.editorEntryID!)))
  })
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
  const canvasResult = createMemo((): StudioGenerationResult | undefined => {
    const r = result()
    const deleted = deletedImageIds()
    if (!r || deleted.size === 0) return r
    const filtered = r.images.filter((img) => !deleted.has(img.id))
    const r2 = filtered.length === r.images.length ? r : { ...r, images: filtered }
    return r2.images.length > 0 ? r2 : undefined
  })
  const effectiveStatus = createMemo<StudioGenerationStatus>(() => {
    if (canvasResult()?.images.length) return "succeeded"
    // isBusy 优先于 result status 检查，避免发送新生成时
    // 因旧 turn 的 failed result 导致闪现"生成失败"
    if (isBusy()) return "running"
    if (status() === "create_failed" || result()?.status === "create_failed") return "create_failed"
    if (status() === "failed" || result()?.status === "failed") return "failed"
    if (result()?.status === "queued") return "queued"
    if (result()?.status === "running") return "running"
    if (studioTurn()?.toolError) return "failed"
    if (studioTurn()?.assistantText && params.id) return "failed"
    if (status() === "succeeded") return "succeeded"
    return status()
  })

  const selectedImage = createMemo(() => {
    const images = canvasResult()?.images ?? []
    return images.find((item) => item.id === selectedImageId()) ?? images[0]
  })
  const workspaceEditImage = createMemo(() => workspaceImage() ?? (workspaceUploadRequested() ? undefined : selectedImage()))

  createEffect(() => {
    const r = canvasResult()
    if (!r) return
    const first = r.images[0]?.id
    if (!first || r.images.some((image) => image.id === selectedImageId())) return
    setSelectedImageId(first)
    // Session 切换或首次加载时自动显示 canvas，同时将首图加入真实 tab
    if (selectedResultId() === undefined) {
      // 同一结果只自动添加一次，避免用户关闭 tab 后被重新添加
      if (processedAutoAddResults.has(r.id)) return
      processedAutoAddResults.add(r.id)
      setShowStudioCanvas(true)
      if (canvasTabImages().length === 0) {
        // 无 tabs：创建第一个 tab
        setCanvasTabImages([r.images[0]])
        setCanvasTabLabels({ [r.images[0].id]: r.images.length > 1 ? `${extractKeywords(r.prompt)}-1` : extractKeywords(r.prompt) })
      } else {
        // 已有 tabs：追加，与 selectStudioImage 逻辑一致
        setCanvasTabImages((prev) => {
          if (prev.some((i) => i.id === r.images[0].id)) return prev
          return [...prev, r.images[0]]
        })
        setCanvasTabLabels((prev) => {
          if (prev[r.images[0].id]) return prev
          return { ...prev, [r.images[0].id]: r.images.length > 1 ? `${extractKeywords(r.prompt)}-1` : extractKeywords(r.prompt) }
        })
      }
    }
  })

  function extractKeywords(text: string, maxLen: number = 20): string {
    if (!text) return "image"
    const firstLine = text.split("\n")[0].trim()
    const cleaned = firstLine
      .replace(/[\\/:*?\"<>|，。！？、；：""''（）【】《》!?;:()\[\]{}@#$%^&+=~`]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
    const prefix = cleaned.length > maxLen ? cleaned.slice(0, maxLen).replace(/-+$/, "") : (cleaned || "image")
    return prefix
  }
  function selectStudioImage(input: { resultID: string; imageID: string }) {
    batch(() => {
      setSelectedResultId(input.resultID)
      const r = displayTurns().map((t) => t.result).find((item) => item?.id === input.resultID)
      if (!r) return
      // 该 result 是否已有 tab
      const hasTab = canvasTabImages().some((tabImg) => r.images.some((img) => img.id === tabImg.id))
      if (hasTab) {
        // 已有 tab → 只切选中，不新增
        setSelectedImageId(input.imageID)
        setShowStudioCanvas(true)
        const imageIndex = r.images.findIndex((img) => img.id === input.imageID)
        const tabImg = canvasTabImages().find((tabImg) => r.images.some((img) => img.id === tabImg.id))
        if (tabImg && imageIndex !== -1) {
          setCanvasTabLabels((prev) => ({
            ...prev,
            [tabImg.id]: r.images.length > 1 ? `${extractKeywords(r.prompt)}-${imageIndex + 1}` : extractKeywords(r.prompt),
          }))
        }
        setDeletedImageIds(new Set<string>())
        setWorkspaceImage(undefined)
        setWorkspaceUploadRequested(false)
        setMode("preview")
        return
      }
      // 还没有 tab → 用第一张图创建 1 个 tab，展示点击的图片
      const first = r.images[0]
      if (first) {
        const imageIndex = r.images.findIndex((img) => img.id === input.imageID)
        setSelectedImageId(input.imageID)
        setShowStudioCanvas(true)
        setCanvasTabImages((prev) => [...prev, first])
        setCanvasTabLabels((prev) => ({ ...prev, [first.id]: r.images.length > 1 ? `${extractKeywords(r.prompt)}-${imageIndex + 1}` : extractKeywords(r.prompt) }))
        setDeletedImageIds(new Set<string>())
        setWorkspaceImage(undefined)
        setWorkspaceUploadRequested(false)
        setMode("preview")
      }
    })
  }

  function selectCanvasTab(id: string) {
    const turn = displayTurns()
      .map((t) => t.result)
      .find((r) => r?.images.some((img) => img.id === id))
    batch(() => {
      if (turn) setSelectedResultId(turn.id)
      setSelectedImageId(id)
      setDeletedImageIds(new Set<string>())
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("preview")
    })
  }

  function closeCanvasTab(id: string) {
    let nextId: string | undefined
    setCanvasTabImages((prev) => {
      const idx = prev.findIndex((img) => img.id === id)
      if (idx === -1) return prev
      const rest = prev.filter((img) => img.id !== id)
      nextId = rest[idx]?.id ?? rest[idx - 1]?.id
      return rest
    })
    setCanvasTabLabels((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    batch(() => {
      if (nextId !== undefined) {
        setSelectedImageId(nextId)
        const turn = displayTurns()
          .map((t) => t.result)
          .find((r) => r?.images.some((img) => img.id === nextId))
        if (turn) setSelectedResultId(turn.id)
      } else {
        // 最后一个 tab：隐藏 canvas 和 details
        // 注意：不清空 selectedImageId，否则 auto-show effect 会重新创建 tab
        setShowStudioCanvas(false)
      }
    })
  }

  createEffect(() => {
    const pending = pendingResult()
    if (!pending) return
    if (studioTurn()?.id === pending.id) return
    if (studioTurn()?.userText !== pending.prompt) return
    if (isStudioGenerationFailure(pending.status) && studioTurn()?.toolRunning) return
    if (pending.status === "succeeded" && pending.images.length > 0 && studioTurn()?.toolRunning) return
    if (studioTurn()?.result?.status === "queued" || studioTurn()?.result?.status === "running") {
      const next = studioTurn()!.result!
      if (isStudioGenerationStatusRegression(pending.status, next.status)) return
      setPendingResult((current) => {
        if (!current || current.status === next.status && current.progress === next.progress && current.order === next.order) return current
        return { ...current, ...next, sourceImage: current.sourceImage }
      })
      setStatus(next.status)
      return
    }
    if (!studioTurn()?.result && !studioTurn()?.toolError) return
    setPendingResult(undefined)
    setStatus(studioTurn()?.result?.status ?? (studioTurn()?.toolError ? "failed" : "succeeded"))
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
    if (studioTurn()?.result?.status === "queued" || studioTurn()?.result?.status === "running") {
      const next = studioTurn()!.result!
      if (isStudioGenerationStatusRegression(pending.status, next.status)) return
      setPendingResult((current) => {
        if (!current || current.status === next.status && current.progress === next.progress && current.order === next.order) return current
        return { ...current, ...next, sourceImage: current.sourceImage }
      })
      setStatus(next.status)
      return
    }
    if (pending.status === "succeeded" && pending.images.length > 0 && studioTurn()?.toolRunning) {
      setStatus("succeeded")
      return
    }
    if (isStudioGenerationFailure(pending.status) && studioTurn()?.toolRunning) {
      setStatus(pending.status)
      return
    }
    if (!studioTurn()?.toolError && !studioTurn()?.assistantText) return
    setPendingResult(undefined)
    setStatus(studioTurn()?.result?.status ?? "failed")
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        const preserveEditorEntry = Boolean(id && id === pendingEditorSessionID)
        const preserveGenerationCapability = Boolean(id && id === pendingGenerationSessionID)
        if (preserveEditorEntry) pendingEditorSessionID = undefined
        if (preserveGenerationCapability) pendingGenerationSessionID = undefined
        if (preserveGenerationCapability && draftVideoRiskConfirmed()) {
          setVideoRiskConfirmedSessionID(id)
          setDraftVideoRiskConfirmed(false)
        }
        if (!preserveGenerationCapability) {
          setVideoRiskConfirmedSessionID(undefined)
          setDraftVideoRiskConfirmed(false)
        }
        setVideoRiskDialogOpen(false)
        if (!id && !sending() && !pendingResult()) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        if (id && !sending() && !preserveGenerationCapability && pendingResult()?.sessionID !== id) {
          setStatus("idle")
          setPendingResult(undefined)
        }
        if (!preserveEditorEntry) {
          setPendingEditorEntries([])
          if (!preserveGenerationCapability) setCapability("image.generate")
        }
        setCanvasTabImages([])
        setCanvasTabLabels({})
        processedAutoAddResults.clear()
        setDeletedImageIds(new Set<string>())
        setSelectedImageId(undefined)
        setSelectedResultId(undefined)
        setShowStudioCanvas(false)
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
    !selectedCapabilityNeedsImage() &&
    (capability() !== "image.generate" || canUseSeedream() || !styleModelRequiresSeedreamPermission(styleModel())) &&
    (
      capability() === "video.generate"
        ? prompt().trim().length > 0 || hasVideoFrames()
        : prompt().trim().length > 0
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
        tracker.interaction({ module: "studio", name: "rename-session" })
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
    tracker.interaction({ module: "studio", name: "delete-session" })
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
      navigate(`/${routeSlug()}/studio/${nextSession.id}`)
      return true
    }
    const decoded = decode64(params.dir)
    if (decoded) layout.lastSessionPerTab.setStudio(decoded, "")
    navigate(`/${routeSlug()}/studio`)
    return true
  }

  function DialogDeleteHeaderSession(props: { session: Session }) {
    const name = createMemo(() => sessionTitle(props.session.title) ?? language.t("command.session.new"))
    const handleDelete = async () => {
      await deleteHeaderSession(props.session)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit class="delete-dialog">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" class="delete-dialog-btn delete-dialog-btn-primary" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }
  const currentImageLabel = createMemo(() => {
    const image = selectedImage()
    if (!image) return "studio-image.png"
    const video = isVideoMedia(image)
    const ext = video ? "mp4" : "png"
    const images = canvasResult()?.images ?? []
    const index = image ? images.findIndex((item) => item.id === image.id) + 1 : 1
    const stored = canvasTabLabels()[image.id]
    if (stored) return `${stored}-${Math.max(index, 1)}.${ext}`
    const prompt = result()?.prompt ?? ""
    const firstLine = prompt.split("\n")[0].trim()
    const cleaned = firstLine
      .replace(/[\\/:*?\"<>|，。！？、；：""''（）【】《》!?;:()\[\]{}@#$%^&+=~`]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
    const prefix = cleaned.length > 20 ? cleaned.slice(0, 20).replace(/-+$/, "") : (cleaned || "image")
    return `${prefix}-${Math.max(index, 1)}.${ext}`
  })

  async function downloadCurrentImage() {
    const image = selectedImage()
    if (!image) return
    tracker.interaction({
      module: "studio",
      name: "download",
      extend: JSON.stringify({ name: currentImageLabel(), url: image.remoteUrl ?? image.url }),
    })
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
          conversationScrollRef.scrollTo({ top: conversationScrollRef.scrollHeight })
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
        // 若已在编辑模式（由 openHD/openCutout/openInpaint/openOutpaint 触发），
        // 不覆盖 workspaceUploadRequested，避免编辑区变成上传界面而非复用原图。
        if (isEditingWorkspaceMode()) return
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

  function readBlobAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Unable to read image data."))
          return
        }
        resolve(reader.result)
      }
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read image data."))
      reader.readAsDataURL(blob)
    })
  }

  async function resolveImageDataUrl(image: StudioImage) {
    if (image.remoteUrl?.startsWith("data:image/")) return image.remoteUrl
    if (image.url.startsWith("data:image/")) return image.url
    const response = await fetch(image.remoteUrl ?? image.url)
    if (!response.ok) throw new Error(`Unable to load selected image. status=${response.status}`)
    const blob = await response.blob()
    if (!blob.type.startsWith("image/")) throw new Error(`Selected media is not an image. content-type=${blob.type || "unknown"}`)
    return readBlobAsDataUrl(blob)
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

  function autoSetAspectRatioFromDimensions(width: number, height: number) {
    if (!width || !height) return
    const imageRatio = width / height
    const candidates: { key: StudioAspectRatio; value: number }[] = [
      { key: "1:1", value: 1 },
      { key: "2:3", value: 2 / 3 },
      { key: "3:4", value: 3 / 4 },
      { key: "9:16", value: 9 / 16 },
      { key: "3:2", value: 3 / 2 },
      { key: "4:3", value: 4 / 3 },
      { key: "16:9", value: 16 / 9 },
    ]
    let best = candidates[0]
    let bestDiff = Math.abs(imageRatio - best.value)
    for (const item of candidates) {
      const diff = Math.abs(imageRatio - item.value)
      if (diff < bestDiff) {
        bestDiff = diff
        best = item
      }
    }
    setAspectRatio(best.key)
  }

  const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const

  function addAssets(files: File[]) {
    const file = files.find((item) => item.type.startsWith("image/"))
    if (!file) return
    const isJimeng = imageTool() === "jimeng"
    const allowedExts = isJimeng ? ["png", "jpg", "jpeg"] : (ALLOWED_IMAGE_EXTENSIONS as readonly string[])
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!ext || !allowedExts.includes(ext)) {
      showToast({
        title: "上传失败",
        description: isJimeng ? "仅支持 .png、.jpg、.jpeg 格式文件。" : "仅支持 .png、.jpg、.jpeg、.webp 格式文件。",
      })
      return
    }
    const maxSize = isJimeng ? 15 * 1024 * 1024 : 8 * 1024 * 1024
    const maxSizeLabel = isJimeng ? "15MB" : "8MB"
    if (file.size > maxSize) {
      showToast({
        title: "上传失败",
        description: `图片文件大小不能超过 ${maxSizeLabel}。`,
      })
      return
    }
    tracker.interaction({ module: "studio", name: "add-attachment", extend: JSON.stringify({ count: files.length }) })
    readStudioAsset(file)
      .then((asset) => {
        const img = new Image()
        img.onload = () => {
          if (img.naturalWidth > 7500 || img.naturalHeight > 7500) {
            showToast({
              title: "上传失败",
              description: "图片最大尺寸不能超过 7500px。",
            })
            return
          }
          setAssets([asset])
          autoSetAspectRatioFromDimensions(img.naturalWidth, img.naturalHeight)
        }
        img.onerror = () => {
          showToast({
            title: "上传失败",
            description: "无法读取图片尺寸。",
          })
        }
        img.src = asset.dataUrl
      })
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
    const isJimeng = imageTool() === "jimeng"
    const isGenerate = capability() === "image.generate"
    const allowedExts = isJimeng ? ["png", "jpg", "jpeg"] : (ALLOWED_IMAGE_EXTENSIONS as readonly string[])
    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!ext || !allowedExts.includes(ext)) {
      showToast({
        title: "上传失败",
        description: isJimeng ? "仅支持 .png、.jpg、.jpeg 格式文件。" : "仅支持 .png、.jpg、.jpeg、.webp 格式文件。",
      })
      return
    }
    const isStrictEdit = capability() === "image.outpaint" || capability() === "image.inpaint" || capability() === "image.cutout"
    let maxSize: number
    let maxSizeLabel: string
    if (isStrictEdit) {
      maxSize = 8 * 1024 * 1024
      maxSizeLabel = "8MB"
    } else if (isGenerate) {
      maxSize = isJimeng ? 15 * 1024 * 1024 : 8 * 1024 * 1024
      maxSizeLabel = isJimeng ? "15MB" : "8MB"
    } else {
      maxSize = 20 * 1024 * 1024
      maxSizeLabel = "20MB"
    }
    if (file.size > maxSize) {
      showToast({
        title: "上传失败",
        description: `图片文件大小不能超过 ${maxSizeLabel}。`,
      })
      return
    }
    readWorkspaceImage(file)
      .then((image) => {
        if (image.width != null && image.height != null) {
          if (image.width > 7500 || image.height > 7500) {
            showToast({
              title: "上传失败",
              description: "图片最大尺寸不能超过 7500px。",
            })
            return
          }
          const minSide = capability() === "image.cutout" ? 50 : isStrictEdit ? 300 : 0
          if (minSide > 0 && Math.min(image.width, image.height) < minSide) {
            showToast({
              title: "上传失败",
              description: `图片最小边不能小于 ${minSide}px。`,
            })
            return
          }
        }
        batch(() => {
          setWorkspaceImage(image)
          setWorkspaceUploadRequested(false)
          setSelectedResultId(undefined)
          setSelectedImageId(undefined)
        })
      })
      .catch((error) => {
        showToast({
          title: "上传失败",
          description: error instanceof Error ? error.message : String(error),
        })
      })
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

  async function createStudioEditorEntry(input: {
    sessionID: string
    capability: StudioEditorCapability
    entryID: string
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
    const response = await fetch(new URL("/studio/editor-entries", current.http.url), {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
    const bodyText = await response.text()
    if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
  }

  function createEditorEntry(value: StudioCapability) {
    const nextMode = workspaceModeForCapability(value)
    if (!nextMode) return
    const capability = value as StudioEditorCapability
    const label = capabilityLabel(value)
    const entryID = crypto.randomUUID()
    batch(() => {
      setPendingEditorEntries((entries) => [...entries, {
        id: `studio_editor_pending_${entryID}`,
        userText: label,
        assistantText: "点击前往编辑区",
        editCapability: capability,
        editorEntryID: entryID,
        createdAt: Date.now(),
        isLatest: true,
      }])
      setPrompt("")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(true)
      setSelectedResultId(undefined)
      setSelectedImageId(undefined)
      setMode(nextMode)
    })
    void (async () => {
      try {
        const existingSession = isValidStudioSession(params.id)
        const sessionID = existingSession ? params.id! : await createStudioSession(label)
        if (!sessionID) throw new Error("Unable to create Studio session.")
        if (!existingSession) {
          pendingEditorSessionID = sessionID
          navigate(`/${routeSlug()}/studio/${sessionID}`)
        }
        await createStudioEditorEntry({ sessionID, capability, entryID })
        void loadSessionMessages(sessionID)
          .catch((error) => console.error("[StudioPage] editor entry reload failed", error))
      } catch (error) {
        setPendingEditorEntries((entries) => entries.filter((entry) => entry.editorEntryID !== entryID))
        showToast({
          title: "入口消息保存失败",
          description: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  function applyStudioCapability(value: StudioCapability) {
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
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("preview")
    })
  }

  function selectStudioCapability(value: StudioCapability) {
    if (value !== "video.generate") {
      pendingVideoFirstFrame = undefined
      applyStudioCapability(value)
      return
    }
    if (!canGenerateVideo()) return
    pendingVideoFirstFrame = undefined
    if (params.id ? videoRiskConfirmedSessionID() === params.id : draftVideoRiskConfirmed()) {
      applyStudioCapability(value)
      return
    }
    setVideoRiskDialogOpen(true)
  }

  function cancelVideoRiskDialog() {
    pendingVideoFirstFrame = undefined
    setVideoRiskDialogOpen(false)
  }

  function confirmVideoRiskDialog() {
    if (params.id) setVideoRiskConfirmedSessionID(params.id)
    if (!params.id) setDraftVideoRiskConfirmed(true)
    setVideoRiskDialogOpen(false)
    applyStudioCapability("video.generate")
    if (pendingVideoFirstFrame) setVideoFrames("first", pendingVideoFirstFrame)
    pendingVideoFirstFrame = undefined
  }

  function generateVideoFromSelectedImage() {
    const image = selectedImage()
    if (!image || isVideoMedia(image) || !canGenerateVideo()) return
    tracker.interaction({
      module: "studio",
      name: "video-generate",
      extend: JSON.stringify({
        aspectRatio: aspectRatio(),
        duration: videoDuration(),
        quality: videoQualityMode(),
        mode: videoFrames.first ? "first_last_frame" : "text",
      }),
    })
    void resolveImageDataUrl(image)
      .then((dataUrl) => {
        pendingVideoFirstFrame = {
          id: crypto.randomUUID(),
          name: currentImageLabel(),
          mime: "image/png",
          dataUrl,
        }
        if (!(params.id ? videoRiskConfirmedSessionID() === params.id : draftVideoRiskConfirmed())) {
          setVideoRiskDialogOpen(true)
          return
        }
        applyStudioCapability("video.generate")
        setVideoFrames("first", pendingVideoFirstFrame)
        pendingVideoFirstFrame = undefined
      })
      .catch((error) => {
        pendingVideoFirstFrame = undefined
        showToast({
          title: "图片处理失败",
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  function startNewStudioConversation() {
    tracker.interaction({ module: "studio", name: "new-session" })
    pendingVideoFirstFrame = undefined
    generationToken++
    setVideoRiskDialogOpen(false)
    setVideoRiskConfirmedSessionID(undefined)
    setDraftVideoRiskConfirmed(false)
    setStatus("idle")
    setPendingResult(undefined)
    setSending(false)
    navigate(`/${routeSlug()}/studio?hint=${Date.now()}`)
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
    const isEditorCapability =
      input.capability === "image.upscale" ||
      input.capability === "image.cutout" ||
      input.capability === "image.inpaint" ||
      input.capability === "image.outpaint"
    const opening =
      input.capability === "image.upscale"
        ? "好的，我将提升当前图片的清晰度和细节。"
        : input.capability === "image.inpaint"
          ? "好的，我将根据涂抹区域局部重绘当前图片。"
        : input.capability === "image.outpaint"
          ? `好的，我将扩展当前图片为${aspectRatio()}比例。`
          : input.capability === "video.generate"
            ? `好的，我将为您生成一段${aspectRatio()}比例的视频。`
          : `好的，我将为您生成一张${aspectRatio()}比例的${capabilityLabel(input.capability)}。`
    return [
      opening,
      input.capability === "video.generate" || isEditorCapability ? undefined : `风格模型：${styleModelLabel(styleModel())}`,
      isEditorCapability ? undefined : `画幅比例：${aspectRatio()}`,
      isEditorCapability ? undefined : `生成数量：${count()}`,
      input.sourceImage
        ? "将基于当前画面设定重新生成。"
        : undefined,
      `用户需求：${input.text}`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n")
  }

  function stringArrayValue(value: unknown) {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string" && item.length > 0)
  }

  function countValue(value: unknown) {
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined
  }

  function aspectRatioValue(value: unknown) {
    return STUDIO_ASPECT_RATIOS.includes(value as StudioAspectRatio) ? value as StudioAspectRatio : undefined
  }

  function videoDurationValue(value: unknown) {
    return value === "10" ? "10" : value === "5" ? "5" : undefined
  }

  function videoQualityModeValue(value: unknown) {
    return value === "pro" ? "pro" : value === "std" ? "std" : undefined
  }

  function dataUrlFromBase64(value?: string) {
    if (!value) return
    return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`
  }

  function inputRecord(result: StudioGenerationResult) {
    const value = recordValue(result.request, "input")
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  }

  function inputExtraRecord(result: StudioGenerationResult) {
    const value = recordValue(inputRecord(result), "extra")
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  }

  function taskRequestRecord(result: StudioGenerationResult) {
    const value = recordValue(recordValue(result.request, "task"), "request")
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  }

  function restoredVideoFrames(result: StudioGenerationResult) {
    const input = inputRecord(result)
    const extra = inputExtraRecord(result)
    const referenceImages = stringArrayValue(recordValue(input, "referenceImages"))
    const args = recordValue(taskRequestRecord(result), "args")
    const restoredFirstFrame =
      stringValue(extra, "firstFrame") ??
      referenceImages[0] ??
      referenceImages[1] ??
      dataUrlFromBase64(stringValue(args, "image"))
    return {
      first: restoredFirstFrame,
      last:
        stringValue(extra, "lastFrame") ??
        (restoredFirstFrame ? referenceImages[1] : undefined) ??
        dataUrlFromBase64(stringValue(args, "image_tail")),
    }
  }

  function restoreGenerationInput(result: StudioGenerationResult): StudioGenerationOverrides {
    const input = inputRecord(result)
    const extra = inputExtraRecord(result)
    const nextAspectRatio = aspectRatioValue(recordValue(input, "aspectRatio")) ?? result.aspectRatio
    const nextCount = countValue(recordValue(input, "count")) ?? (result.images.length >= 1 && result.images.length <= 4 ? result.images.length as 1 | 2 | 3 | 4 : undefined)
    if (result.capability === "video.generate") {
      return {
        capability: result.capability,
        prompt: typeof input?.prompt === "string" ? input.prompt : result.prompt,
        referenceImages: stringArrayValue(recordValue(input, "referenceImages")),
        extra: extra ? { ...extra } : undefined,
        videoFrames: restoredVideoFrames(result),
        aspectRatio: nextAspectRatio,
        count: nextCount,
        videoDuration: videoDurationValue(recordValue(extra, "duration")) ?? result.duration,
        videoQualityMode: videoQualityModeValue(recordValue(extra, "mode")) ?? result.videoQualityMode,
        useRestoredInputs: true,
      }
    }
    if (result.capability === "image.generate") {
      return {
        capability: result.capability,
        prompt: typeof input?.prompt === "string" ? input.prompt : result.prompt,
        referenceImages: stringArrayValue(recordValue(input, "referenceImages")),
        extra: extra ? { ...extra } : undefined,
        styleModel: stringValue(input, "styleModel"),
        aspectRatio: nextAspectRatio,
        count: nextCount,
        useRestoredInputs: true,
      }
    }
    return {
      capability: result.capability,
      prompt: typeof input?.prompt === "string" ? input.prompt : result.prompt,
      sourceImage: stringValue(input, "sourceImage"),
      extra: extra ? { ...extra } : undefined,
      aspectRatio: nextAspectRatio,
      count: nextCount,
      useRestoredInputs: true,
    }
  }

  async function createStudioGeneration(input: {
    sessionID: string
    text: string
    capability: StudioCapability
    styleModel?: string
    aspectRatio?: StudioAspectRatio
    count?: 1 | 2 | 3 | 4
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
    const timeout = setTimeout(() => controller.abort(), STUDIO_GENERATION_CREATE_TIMEOUT_MS)
    const response = await fetch(new URL("/studio/generations", current.http.url), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        sessionID: input.sessionID,
        capability: input.capability,
        prompt: input.text,
        styleModel: input.capability === "image.generate" ? input.styleModel ?? styleModelLabel(styleModel()) : undefined,
        aspectRatio: input.capability === "image.generate" || input.capability === "video.generate" ? input.aspectRatio ?? aspectRatio() : undefined,
        count: input.capability === "image.generate" || input.capability === "video.generate" ? input.count ?? count() : undefined,
        imageTool: imageTool(),
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

  async function getStudioGeneration(id: string, signal?: AbortSignal) {
    const current = server.current
    if (!current) throw new Error("No active server.")
    const headers: Record<string, string> = {
      "x-opencode-directory": projectDir(),
    }
    if (current.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const response = await fetch(new URL(`/studio/generations/${encodeURIComponent(id)}`, current.http.url), {
      headers,
      signal,
    })
    const bodyText = await response.text()
    if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
    return JSON.parse(bodyText) as StudioGenerationResult
  }

  async function cancelStudioGeneration(id: string) {
    if (cancellingGenerationIDs().has(id)) return
    tracker.interaction({ module: "studio", name: "stop-generation" })
    const current = server.current
    if (!current) {
      console.error("[StudioPage] cancel generation failed", new Error("No active server."))
      return
    }
    setCancellingGenerationIDs((ids) => new Set([...ids, id]))
    try {
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
      const timeout = setTimeout(() => controller.abort(), STUDIO_GENERATION_CANCEL_TIMEOUT_MS)
      const response = await fetch(
        new URL(`/studio/generations/${encodeURIComponent(id)}/cancel`, current.http.url),
        { method: "POST", headers, signal: controller.signal },
      ).finally(() => clearTimeout(timeout))
      const bodyText = await response.text()
      if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
      const generation = JSON.parse(bodyText) as StudioGenerationResult
      setPendingResult((item) => {
        if (!item || item.id !== generation.id) return item
        return { ...generation, sourceImage: item.sourceImage }
      })
      setStatus(generation.status)
      const sessionID = generation.sessionID ?? params.id
      if (sessionID) {
        void loadSessionMessages(sessionID).catch((error) => {
          console.error("[StudioPage] cancelled session load failed", error)
        })
      }
    } catch (error) {
      console.error("[StudioPage] cancel generation failed", error)
    } finally {
      setCancellingGenerationIDs((ids) => new Set([...ids].filter((generationID) => generationID !== id)))
    }
  }

  function isStudioGenerationID(id: string) {
    return id.startsWith("studio_gen")
  }

  async function runGeneration(overrides?: StudioGenerationOverrides) {
    const nextCapability = overrides?.capability ?? capability()
    const nextStyleModel = overrides?.styleModel ?? styleModelLabel(styleModel())
    const nextAspectRatio = overrides?.aspectRatio ?? aspectRatio()
    const nextCount = overrides?.count ?? count()
    const nextVideoDuration = overrides?.videoDuration ?? videoDuration()
    const nextVideoQualityMode = overrides?.videoQualityMode ?? videoQualityMode()
    const restoredVideoFrames = overrides?.videoFrames
    const nextVideoFrames = restoredVideoFrames
      ? restoredVideoFrames
      : overrides?.useRestoredInputs
        ? {}
        : {
            first: videoFrames.first?.dataUrl,
            last: videoFrames.last?.dataUrl,
          }
    const nextHasVideoFrames = nextCapability === "video.generate" && Boolean(nextVideoFrames.first || nextVideoFrames.last)
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
    const currentToken = ++generationToken
    const previousPrompt = prompt()
    const previousAssets = assets()
    const previousVideoFrames = { first: videoFrames.first, last: videoFrames.last }
    const videoReferenceImages = [
      nextVideoFrames.first ?? nextVideoFrames.last,
      nextVideoFrames.first ? nextVideoFrames.last : undefined,
    ].filter((item): item is string => Boolean(item))
    const referenceImages = overrides?.referenceImages ?? (
      nextCapability === "image.generate"
        ? overrides?.useRestoredInputs
          ? []
          : assets().map((item) => item.dataUrl)
        : nextCapability === "video.generate"
          ? videoReferenceImages
          : []
    )
    tracker.interaction({
      module: "studio",
      name: "send-message",
      extend: JSON.stringify({
        capability: nextCapability,
        aspectRatio: aspectRatio(),
        count: count(),
        styleModel: styleModel(),
        hasReferenceImage: referenceImages.length > 0,
      }),
    })
    const studioContext = overrides?.useRestoredInputs
      ? ""
      : params.id
        ? buildStudioConversationContext({
            messages: dataStore.message[params.id] ?? [],
            parts: dataStore.part,
          })
        : ""
    setOpenMenu(null)
    setMode("preview")
    setSending(true)
    setStatus("submitting")
    setSelectedResultId(undefined)
    setPendingResult({
      id: `studio_pending_${Date.now()}`,
      status: "running",
      capability: nextCapability,
      prompt: text,
      provider: "internel",
      model: nextStyleModel,
      aspectRatio: nextAspectRatio,
      images: [],
      progress: 0,
      createdAt: Date.now(),
      sourceImage: overrides?.sourceImage,
      ...(nextCapability === "video.generate"
        ? {
            videoMode: nextHasVideoFrames ? "first_last_frame" : "text",
            duration: nextVideoDuration,
            videoQualityMode: nextVideoQualityMode,
          }
        : {}),
    })
    if (!overrides?.useRestoredInputs) {
      setPrompt("")
      setAssets([])
    }
    try {
      const existingSession = isValidStudioSession(params.id)
      const sessionID = existingSession ? params.id! : await createStudioSession(text)
      if (!sessionID) throw new Error("Unable to create Studio session.")
      if (currentToken !== generationToken) return
      if (!existingSession) {
        pendingGenerationSessionID = sessionID
        setPendingResult((item) => item ? { ...item, sessionID } : item)
        navigate(`/${routeSlug()}/studio/${sessionID}`)
      }
      const generation = await createStudioGeneration({
        sessionID,
        text,
        capability: nextCapability,
        styleModel: nextStyleModel,
        aspectRatio: nextAspectRatio,
        count: nextCount,
        referenceImages,
        sourceImage: overrides?.sourceImage,
        extra: {
          ...(overrides?.extra ?? {}),
          ...(studioContext ? { studioContext } : {}),
          ...(nextCapability === "video.generate"
            ? {
              videoMode: nextHasVideoFrames ? "first_last_frame" : "text",
              duration: nextVideoDuration,
              mode: nextVideoQualityMode,
              firstFrame: nextVideoFrames.first ?? nextVideoFrames.last,
              lastFrame: nextVideoFrames.first ? nextVideoFrames.last : undefined,
            }
            : {}),
        },
      })
      if (!overrides?.useRestoredInputs && nextCapability === "video.generate") clearVideoFrames()
      if (currentToken !== generationToken) return
      setPendingResult({
        ...generation,
        sourceImage: overrides?.sourceImage,
      })
      setStatus(generation.status)
    } catch (error) {
      if (currentToken !== generationToken) return
      console.error("[StudioPage] studio prompt failed", error)
      if (!overrides?.useRestoredInputs) {
        setPrompt(previousPrompt)
        setAssets(previousAssets)
      }
      if (!overrides?.useRestoredInputs && nextCapability === "video.generate") replaceVideoFrames(previousVideoFrames)
      setStatus("create_failed")
      setPendingResult((item) => item ? {
        ...item,
        status: "create_failed",
        error: error instanceof Error ? error.message : String(error),
      } : item)
    } finally {
      if (currentToken === generationToken) setSending(false)
    }
  }

  const pollingGenerationID = createMemo(() => {
    const active = pendingResult() ?? studioTurn()?.result
    if (!active || active.status !== "queued" && active.status !== "running") return
    if (!isStudioGenerationID(active.id)) return
    return active.id
  })

  createEffect(
    on(
      pollingGenerationID,
      (id) => {
        if (!id) return

        const fallback = pendingResult() ?? studioTurn()?.result
        let stopped = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const controller = new AbortController()

        const schedule = () => {
          if (stopped) return
          timer = setTimeout(run, STUDIO_GENERATION_STATUS_INTERVAL_MS)
        }

        const run = async () => {
          if (stopped) return

          try {
            const generation = await getStudioGeneration(id, controller.signal)
            if (stopped) return
            const current = pendingResult()
            if (current && current.id === id && isStudioGenerationStatusRegression(current.status, generation.status)) return

            setPendingResult((current) => {
              if (current && current.id !== id) return current
              if (
                current &&
                current.status === generation.status &&
                current.progress === generation.progress &&
                current.order === generation.order &&
                current.error === generation.error &&
                current.images.length === generation.images.length
              ) return current
              return { ...generation, sourceImage: current?.sourceImage }
            })
            setStatus(generation.status)

            if (
              generation.status === "succeeded" ||
              generation.status === "create_failed" ||
              generation.status === "failed"
            ) {
              const sessionID = generation.sessionID ?? params.id
              if (generation.status === "succeeded" && sessionID) {
                void loadSessionMessages(sessionID).catch((error) => {
                  console.error("[StudioPage] generated session load failed", error)
                })
              }
              return
            }

            schedule()
          } catch (error) {
            if (stopped) return
            if (error instanceof DOMException && error.name === "AbortError") return

            console.error("[StudioPage] generation status load failed", error)
            const message = error instanceof Error ? error.message : String(error)
            const current = pendingResult()
            if (current && current.id !== id) return
            setStatus("failed")
            const base = current ?? fallback
            if (!base) return
            setPendingResult({
              ...base,
              status: "failed",
              error: message,
            })
          }
        }

        void run()

        onCleanup(() => {
          stopped = true
          controller.abort()
          if (timer) clearTimeout(timer)
        })
      },
    ),
  )

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
      setCapability("image.outpaint")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("outpaint")
    })
  }

  function openHD() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isBusy()) return
    batch(() => {
      setCapability("image.upscale")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("hd")
    })
  }

  function openCutout() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isBusy()) return
    batch(() => {
      setCapability("image.cutout")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("cutout")
    })
  }

  function openInpaint() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isBusy()) return
    batch(() => {
      setCapability("image.inpaint")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("inpaint")
    })
  }

  async function submitOutpaint(input: { prompt: string; extra: Record<string, unknown> }) {
    const image = workspaceEditImage()
    if (!image) return
    let sourceUrl = image.remoteUrl ?? image.url

    // Auto-adjust original image (not local upload) if exceeds limits
    if (!workspaceImage()) {
      sourceUrl = await adjustImageForEdit(sourceUrl, { maxSize: 8 * 1024 * 1024, maxDimension: 7500, minSide: 300 })
    }

    tracker.interaction({
      module: "studio",
      name: "outpaint",
      extend: JSON.stringify({
        aspectRatio: aspectRatio(),
        hasCustomPrompt: !!input.prompt,
        hasSourceImage: !!image,
        isUploadedImage: !!workspaceImage(),
      }),
    })
    void runGeneration({
      capability: "image.outpaint",
      sourceImage: sourceUrl,
      prompt: input.prompt || "保留主体和画面风格，扩展更大尺寸和更多环境内容",
      extra: input.extra,
    })
  }

  function submitInpaint(input: {
    prompt: string
    mode: StudioInpaintMode
    brushSize: number
    sourceImage: string
    compositeImage: string
    hasDrawing: boolean
  }) {
    if (isBusy() || !input.hasDrawing) return

    async function doSubmit() {
      let sourceUrl = input.sourceImage
      let compositeData = input.compositeImage

      // Auto-adjust original image (not local upload) if exceeds limits
      if (!workspaceImage()) {
        sourceUrl = await adjustImageForEdit(sourceUrl, { maxSize: 8 * 1024 * 1024, maxDimension: 7500, minSide: 300 })

        // Resize composite image to match if source was adjusted
        if (sourceUrl !== input.sourceImage) {
          compositeData = await resizeCompositeImage(input.compositeImage, sourceUrl)
        }
      }

      tracker.interaction({
        module: "studio",
        name: "inpaint",
        extend: JSON.stringify({
          mode: input.mode,
          brushSize: input.brushSize,
          hasCustomPrompt: !!input.prompt,
          hasDrawing: input.hasDrawing,
          isUploadedImage: !!workspaceImage(),
        }),
      })
      void runGeneration({
        capability: "image.inpaint",
        sourceImage: sourceUrl,
        prompt: input.prompt || (input.mode === "erase" ? "消除涂抹区域内的物体" : "重绘所选区域"),
        extra: {
          generateMode: input.mode,
          compositeImage: compositeData,
          hasDrawing: input.hasDrawing,
        },
      })
    }

    void doSubmit()
  }

  async function resizeCompositeImage(rawBase64: string, targetDataUrl: string): Promise<string> {
    const [compositeImg, targetImg] = await Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Failed to load composite image"))
        img.src = `data:image/png;base64,${rawBase64}`
      }),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Failed to load target image"))
        img.src = targetDataUrl
      }),
    ])

    const canvas = document.createElement("canvas")
    canvas.width = targetImg.naturalWidth
    canvas.height = targetImg.naturalHeight
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(compositeImg, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/png").split(",")[1] ?? rawBase64
  }

  async function adjustImageForEdit(
    sourceUrl: string,
    opts: { maxSize: number; maxDimension: number; minSide: number },
  ): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error("Failed to load image for adjustment"))
      image.src = sourceUrl
    })
    let w = img.naturalWidth
    let h = img.naturalHeight

    // Scale down if either dimension exceeds maxDimension
    if (w > opts.maxDimension || h > opts.maxDimension) {
      const scale = opts.maxDimension / Math.max(w, h)
      w = Math.round(w * scale)
      h = Math.round(h * scale)
    }

    // Scale up if min side is below minimum
    if (opts.minSide > 0 && Math.min(w, h) < opts.minSide) {
      const scale = opts.minSide / Math.min(w, h)
      w = Math.round(w * scale)
      h = Math.round(h * scale)
    }

    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(img, 0, 0, w, h)

    // Compress if file size exceeds maxSize
    let quality = 0.92
    let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    while (blob && blob.size > opts.maxSize && quality > 0.1) {
      quality -= 0.1
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    }

    if (!blob) return sourceUrl
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error("Failed to read adjusted image"))
      reader.readAsDataURL(blob)
    })
  }

  async function submitHD(input: { mode: StudioHDMode }) {
    const image = workspaceEditImage()
    if (!image || isBusy()) return
    let sourceUrl = image.remoteUrl ?? image.url

    // Auto-adjust original image (not local upload) if exceeds limits
    if (!workspaceImage()) {
      sourceUrl = await adjustImageForEdit(sourceUrl, { maxSize: 20 * 1024 * 1024, maxDimension: 7500, minSide: 0 })
    }

    tracker.interaction({ module: "studio", name: "upscale", extend: JSON.stringify({ mode: input.mode, hasSourceImage: !!image, isUploadedImage: !!workspaceImage() }) })
    void runGeneration({
      capability: "image.upscale",
      sourceImage: sourceUrl,
      prompt: "将当前图片变清晰，提升分辨率和细节",
      extra: {
        mode: input.mode,
      },
    })
  }

  async function submitCutout() {
    const image = workspaceEditImage()
    if (!image || isBusy()) return
    let sourceUrl = image.remoteUrl ?? image.url

    // Auto-adjust original image (not local upload) if exceeds limits
    if (!workspaceImage()) {
      sourceUrl = await adjustImageForEdit(sourceUrl, { maxSize: 8 * 1024 * 1024, maxDimension: 7500, minSide: 50 })
    }

    tracker.interaction({ module: "studio", name: "cutout", extend: JSON.stringify({ hasSourceImage: !!image, isUploadedImage: !!workspaceImage() }) })
    void runGeneration({
      capability: "image.cutout",
      sourceImage: sourceUrl,
      prompt: "对当前图片进行抠图，移除背景并保留主体",
    })
  }

  function regenerateCurrentResult() {
    const current = result()
    if (!current) return
    if (current.capability === "video.generate" && !canGenerateVideo()) return
    tracker.interaction({
      module: "studio",
      name: "regenerate",
      extend: JSON.stringify({
        capability: current.capability,
        aspectRatio: current.aspectRatio,
        count: current.images.length,
        hasReferenceImage: current.images.length > 0,
      }),
    })
    void runGeneration(restoreGenerationInput(current))
  }

  const hasStudioConversation = createMemo(() =>
    turns().length > 0 ||
    pendingEditorEntries().length > 0 ||
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
    <div ref={studioPageRef!} class="studio-page" style={{ position: "relative" }}>
      <aside class="studio-left" style={{ width: `${studioLeftWidth()}px`, "flex-basis": `${studioLeftWidth()}px` }}>
        <StudioHistory
          directory={projectDir()}
          routeSlug={routeSlug()}
          activeSessionID={params.id}
          onNewConversation={startNewStudioConversation}
        />
      </aside>
      <div
        style={{
          position: "absolute",
          top: "0",
          bottom: "0",
          left: `${studioLeftWidth()}px`,
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
                  canGenerateVideo={canGenerateVideo()}
                  canUseSeedream={canUseSeedream()}
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
            viewportRef={(el) => {
              conversationScrollRef = el
              requestAnimationFrame(() => {
                el.scrollTo({ top: el.scrollHeight })
              })
            }}
            class="studio-center-scroll"
          >
            <Show when={displayTurns().length > 0 || pendingResult() || sending()} fallback={<StudioIntro />}>
              <StudioConversation
                result={result()}
                turns={displayTurns()}
                busy={effectiveStatus() === "queued" || effectiveStatus() === "running" || effectiveStatus() === "submitting"}
                cancellingGenerationIDs={cancellingGenerationIDs()}
                onCancelGeneration={(generationID) => void cancelStudioGeneration(generationID)}
                onSelectImage={selectStudioImage}
                onOpenEditor={openEditorEntry}
              />
            </Show>
          </ScrollView>

          <StudioComposer
            prompt={prompt()}
            capability={capability()}
            canGenerateVideo={canGenerateVideo()}
            canUseSeedream={canUseSeedream()}
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
          style={{ left: `${studioLeftWidth() + studioCenterWidth()}px`, width: "8px" }}
          onMouseDown={handleStudioCenterResize}
        />

      <main class="studio-workspace">
        <Show when={isEditingWorkspaceMode() || showStudioCanvas() || isBusy()} fallback={
          <div class="studio-empty-workspace">
            <StudioIntro />
          </div>
        }>
        <section class="studio-canvas">
          <Show when={isEditingWorkspaceMode() || showStudioCanvas() || canvasTabImages().length > 0}>
          <Show when={isEditingWorkspaceMode()} fallback={
            <StudioResultCanvas
              videoPlayerMount={() => studioPageRef}
              fullscreenMount={() => studioPageRef}
              status={effectiveStatus()}
              image={selectedImage()}
              result={canvasResult()}
              imageLabel={currentImageLabel()}
              selectedImageId={selectedImageId()}
              tabImages={canvasTabImages()}
              tabLabels={canvasTabLabels()}
              onDownload={() => void downloadCurrentImage()}
              onSelectImage={selectCanvasTab}
              onDeleteImage={(id) => {
                batch(() => {
                  // fallback 模式（无 tabs）：只有一个关闭按钮，删除全部图片隐藏 canvas 和 details
                  setShowStudioCanvas(false)
                  const allIds = result()?.images.map((img) => img.id) ?? []
                  setDeletedImageIds(new Set(allIds))
                  setSelectedImageId(undefined)
                })
              }}
              onCloseTab={closeCanvasTab}
            />
          }>
            <Show when={!workspaceEditImage()}>
              <StudioWorkspaceUpload onUpload={uploadWorkspaceImage} />
            </Show>
            <Show when={mode() === "hd" && workspaceEditImage()}>
              {(image) => (
                <StudioHDEditor
                  image={image()}
                  onClose={deleteWorkspaceImage}
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
                  onClose={deleteWorkspaceImage}
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
                  onClose={deleteWorkspaceImage}
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
                  onClose={deleteWorkspaceImage}
                  onDelete={deleteWorkspaceImage}
                  onSubmit={submitInpaint}
                />
              )}
            </Show>
          </Show>
          </Show>
          <Show when={isBusy() && !showStudioCanvas() && canvasTabImages().length === 0}>
            <div class="flex-1 flex flex-col items-center justify-center text-center">
              <StudioEmptyState />
            </div>
          </Show>
        </section>
        </Show>

          <Show when={!isEditingWorkspaceMode() && showStudioCanvas() && canvasResult()?.images.length}>
            <aside class="studio-details">
              <StudioDetails
                result={result()!}
                image={selectedImage()}
                selectedImageId={selectedImageId()}
                imageLabel={currentImageLabel()}
                regenerateDisabled={isBusy() || result()!.capability === "video.generate" && !canGenerateVideo()}
                showVideoGeneration={canGenerateVideo()}
                onSelectImage={(id) => {
                  const r = result()
                  batch(() => {
                    setShowStudioCanvas(true)
                    if (r && canvasTabImages().some((tabImg) => r.images.some((img) => img.id === tabImg.id))) {
                      // 已有 tab → 只切选中
                      setSelectedImageId(id)
                      const imageIndex = r.images.findIndex((img) => img.id === id)
                      const tabImg = canvasTabImages().find((tabImg) => r.images.some((img) => img.id === tabImg.id))
                      if (tabImg && imageIndex !== -1) {
                        setCanvasTabLabels((prev) => ({
                          ...prev,
                          [tabImg.id]: r.images.length > 1 ? `${extractKeywords(r.prompt ?? "")}-${imageIndex + 1}` : extractKeywords(r.prompt ?? ""),
                        }))
                      }
                      setDeletedImageIds(new Set<string>())
                      setWorkspaceImage(undefined)
                      setWorkspaceUploadRequested(false)
                      setMode("preview")
                      return
                    }
                    // 还没有 tab → 用第一张图创建 1 个 tab，展示点击的图片
                    const first = r?.images[0]
                    if (first) {
                      const imageIndex = r.images.findIndex((img) => img.id === id)
                      setSelectedImageId(id)
                      setCanvasTabImages((prev) => [...prev, first])
                      setCanvasTabLabels((prev) => ({ ...prev, [first.id]: (r?.images.length ?? 0) > 1 ? `${extractKeywords(r?.prompt ?? "")}-${imageIndex + 1}` : extractKeywords(r?.prompt ?? "") }))
                      setDeletedImageIds(new Set<string>())
                      setWorkspaceImage(undefined)
                      setWorkspaceUploadRequested(false)
                      setMode("preview")
                    }
                  })
                }}
                onRegenerate={regenerateCurrentResult}
                onGenerateVideo={generateVideoFromSelectedImage}
                onUpscale={openHD}
                onCutout={openCutout}
                onInpaint={openInpaint}
                onOutpaint={openOutpaint}
              />
            </aside>
          </Show>
        </main>
      </Show>
      <input ref={fileInputRef!} type="file" accept=".png,.jpg,.jpeg,.webp" class="hidden" onChange={handleFileChange} />
      <input ref={videoFrameInputRef!} type="file" accept="image/png,image/jpeg" class="hidden" onChange={handleVideoFrameFileChange} />
      <Show when={videoRiskDialogOpen()}>
        <StudioVideoRiskDialog onCancel={cancelVideoRiskDialog} onConfirm={confirmVideoRiskDialog} />
      </Show>
    </div>
  )
}
