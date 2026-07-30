import "./studio/studio.css"
import type { Part, Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { tracker } from "@/utils/tracker"
import { batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore, produce, reconcile } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import { DialogSettings } from "@/components/dialog-settings"
import { showFloatingNotice } from "@/components/floating-notice"
import { useProjectDir } from "@/hooks/use-project-dir"
import { sessionTitle } from "@/utils/session-title"
import { authTokenFromCredentials } from "@/utils/server"
import { directoryHeader } from "@/utils/headers"
import { modelsApiHeaders } from "@/network/models-api"
import { useModels } from "@/context/models"
import { useServer } from "@/context/server"
import {
  STUDIO_ASPECT_RATIOS,
  capabilityLabel,
  referenceImageLimit,
  styleModelId,
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
  buildStudioInputImages,
  buildStudioTurns,
  closestStudioAspectRatio,
  parseToolAttachments,
  parseToolImages,
  type StudioTurnData,
} from "./studio/turns"
import { StudioHistory } from "./studio/studio-history"
import { StudioComposer, StudioIntro } from "./studio/studio-composer"
import { StudioConversation, StudioDetails, StudioEmptyState, StudioResultCanvas, StudioWorkspaceUpload } from "./studio/studio-conversation"
import { StudioCutoutEditor, StudioHDEditor } from "./studio/studio-editors-basic"
import { StudioInpaintEditor } from "./studio/studio-inpaint-editor"
import { StudioOutpaintEditor } from "./studio/studio-outpaint-editor"
import { StudioVideoRiskDialog } from "./studio/studio-video-risk-dialog"
import { STUDIO_FILTER_STATE_KEY_PREFIX } from "./studio/studio-file-manager"
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
  STUDIO_GENERATION_REBOOT_TIMEOUT_MS,
  STUDIO_GENERATION_STATUS_INTERVAL_MS,
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
import { createSessionThumbnailStore, type ThumbnailMap } from "./studio/session-thumbnail"
import { getArtifactRelativePath, getArtifactServeUrl } from "./make/utils/artifact-file-api"

type StudioEditorCapability = "image.upscale" | "image.cutout" | "image.inpaint" | "image.outpaint"
const STUDIO_REGENERATE_DISPLAY_PROMPT = "再次生成"
const STUDIO_REGENERATE_ASSISTANT_TEXT = "好的，我会按当前结果的配置重新生成。"

// 探测图片真实宽高，映射到最接近的 Studio 比例；用于编辑类结果保留源图比例
async function probeImageAspectRatio(url: string): Promise<StudioAspectRatio | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("image load failed"))
      el.src = url
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w && h) return closestStudioAspectRatio(w, h)
  } catch { /* noop */ }
  return undefined
}

type StudioPromptGenResponse = {
  resp_code?: number
  resp_msg?: string
  result?: {
    en?: string
    zh?: string
  }
}

type StudioGenerationOverrides = {
  capability?: StudioCapability
  prompt?: string
  displayPrompt?: string
  detailPrompt?: string
  detailTitle?: string
  refinedPrompt?: string
  effectivePrompt?: string
  sourceImage?: string
  referenceImages?: string[]
  extra?: Record<string, unknown>
  videoFrames?: { first?: string; last?: string }
  styleModel?: string
  aspectRatio?: StudioAspectRatio
  width?: number
  height?: number
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
  const models = useModels()
  const dialog = useDialog()
  let studioPermissionChecked = false
  let studioPageRef!: HTMLDivElement

  onMount(() => { tracker.page({ module: "studio", name: "studio-page" }) })
  onCleanup(() => {
    toaster.clear()
    // 离开 studio 页面时清除所有 session 的筛选状态
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(STUDIO_FILTER_STATE_KEY_PREFIX)) localStorage.removeItem(key)
    }
  })

  const projectDir = useProjectDir({ mode: "config" })
  const [syncStore, setSyncStore] = globalSync.child(projectDir(), { bootstrap: true })

  const isValidStudioSession = (sessionId: string | undefined): boolean => {
    if (!sessionId) return false
    // Fast path: check global sync store.
    const session = syncStore.session.find(s => s.id === sessionId)
    if (session?.agent === "octo_studio") return true
    // Fallback: if messages have already been loaded for this session (the user
    // is actively viewing it), treat it as valid even if the sync store hasn't
    // caught up yet.  Otherwise runGeneration/openInpaint would create a new
    // session when the user clicks generate in an existing one.
    if (dataStore.message[sessionId]) return true
    return false
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
    // 重置为默认生图模式，避免持久化的编辑 capability 导致
    // hasStudioConversation 误判为 true，从而不显示 studio-empty-workspace
    if (workspaceModeForCapability(capability())) setCapability("image.generate")
    const decoded = decode64(params.dir)
    if (!decoded) return
    const lastId = layout.lastSessionPerTab.studio(decoded)
    if (!lastId || !isValidStudioSession(lastId)) return
    navigate(`/${routeSlug()}/studio/${lastId}`, { replace: true })
  })

  const [prompt, setPrompt] = createSignal("")
  const [imageSettingStore, setImageSettingStore] = persisted(
    Persist.global("studio.image.settings"),
    createStore({
      capability: "image.generate" as StudioCapability,
      styleModel: "seedream-5-lite",
    }),
  )
  const [imageSessionStore, setImageSessionStore] = persisted(
    Persist.sessionGlobal("studio.image.session"),
    createStore({
      aspectRatio: "3:4" as StudioAspectRatio,
      count: 4 as 1 | 2 | 3 | 4,
      customWidth: 0,
      customHeight: 0,
      isCustom: false,
    }),
  )
  const capability = () => imageSettingStore.capability
  const setCapability = (v: StudioCapability) => setImageSettingStore("capability", v)
  const aspectRatio = () => imageSessionStore.aspectRatio
  const setAspectRatio = (v: StudioAspectRatio) => setImageSessionStore("aspectRatio", v)
  const count = () => imageSessionStore.count
  const setCount = (v: 1 | 2 | 3 | 4) => setImageSessionStore("count", v)
  const styleModel = () => imageSettingStore.styleModel
  const setStyleModel = (v: string) => setImageSettingStore("styleModel", v)
  const customWidth = () => imageSessionStore.customWidth
  const setCustomWidth = (v: number) => setImageSessionStore("customWidth", v)
  const customHeight = () => imageSessionStore.customHeight
  const setCustomHeight = (v: number) => setImageSessionStore("customHeight", v)
  const isCustomStore = () => imageSessionStore.isCustom
  const setIsCustomStore = (v: boolean) => setImageSessionStore("isCustom", v)
  const maxReferenceImages = () => referenceImageLimit(styleModel())
  const [imageTool, setImageTool] = createSignal<StudioImageTool>("internel")
  const [assets, setAssets] = createSignal<StudioAsset[]>([])
  const [videoFrames, setVideoFrames] = createStore<{ first?: StudioAsset; last?: StudioAsset }>({})
  let reversePromptRunning = false
  let reversePromptController: AbortController | undefined
  const [videoDuration, setVideoDuration] = createSignal<StudioVideoDuration>("5")
  const [videoQualityMode, setVideoQualityMode] = createSignal<StudioVideoQualityMode>("std")
  const [status, setStatus] = createSignal<StudioGenerationStatus>("idle")
  const [pendingResult, setPendingResult] = createSignal<StudioPendingResult>()
  const [cancellingGenerationIDs, setCancellingGenerationIDs] = createSignal<ReadonlySet<string>>(new Set())
  const [rebootingGenerationIDs, setRebootingGenerationIDs] = createSignal<ReadonlySet<string>>(new Set())
  const [selectedResultId, setSelectedResultId] = createSignal<string>()
  const [selectedImageId, setSelectedImageId] = createSignal<string>()
  const [deletedImageIds, setDeletedImageIds] = createSignal<Set<string>>(new Set())
  const processedAutoAddResults = new Set<string>()
  const [studioViewPref, setStudioViewPref] = persisted(
    Persist.global("studio.view.preference"),
    createStore({ mode: "canvas" as "canvas" | "file-manager" }),
  )
  const [showStudioCanvas, setShowStudioCanvas] = createSignal(true)
  const [showStudioDetails, setShowStudioDetails] = createSignal(false)
  const [showFileManager, setShowFileManager] = createSignal(true)
  const [fileManagerDetailView, setFileManagerDetailView] = createSignal(false)
  // 记录上一次 session id，切换 session 时重置视图偏好
  let lastStudioSessionId: string | undefined
  // 记录文件管理详情页当前查看的 resultId / imageId，从 canvas 切回时恢复
  let fileManagerDetailResultId: string | undefined
  let fileManagerDetailImageId: string | undefined
  const [fileManagerGenPending, setFileManagerGenPending] = createSignal(false)
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
  onCleanup(() => reversePromptController?.abort())
  const [draftVideoRiskConfirmed, setDraftVideoRiskConfirmed] = createSignal(false)
  const [wordBook] = createResource(
    () => server.current,
    async (current: any) => {
      const headers: Record<string, string> = {
        accept: "application/json",
        ...directoryHeader(projectDir()),
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
      ...directoryHeader(projectDir()),
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
  let createGenerationController: AbortController | undefined
  const terminatedGenerationIDs = new Set<string>()
  const [studioLeftCollapsed, setStudioLeftCollapsed] = createSignal(false)
  const [studioLeftStore, setStudioLeftStore] = persisted(
    Persist.global("studio.left.width"),
    createStore({ width: 296 }),
  )
  const [studioLeftWidth, setStudioLeftWidth] = createSignal(studioLeftStore.width)
  const toggleStudioLeft = () => setStudioLeftCollapsed((v) => !v)
  const [studioCenterStore, setStudioCenterStore] = persisted(
    Persist.global("studio.center.width"),
    createStore({ width: 468 }),
  )
  const [studioCenterWidth, setStudioCenterWidth] = createSignal(studioCenterStore.width)
  const { dataStore, loadSessionMessages, sessionStatus } = createStudioSessionData({
    sessionID: () => params.id,
    globalSDK,
  })
  const studioThumbnails = createSessionThumbnailStore({
    dir: () => projectDir(),
    globalSDK,
  })

  // Reactive effect: auto-update thumbnail whenever pendingResult transitions to succeeded.
  createEffect(() => {
    const result = pendingResult()
    console.log("[Thumbnail] Effect tick, pendingResult:", result?.status, "sessionID:", result?.sessionID, "images:", result?.images?.length)
    if (!result || result.status !== "succeeded") return
    const sid = result.sessionID ?? params.id
    const images = result.images
    if (sid && images && images.length > 0) {
      console.log("[Thumbnail] Effect setThumbnail for session", sid, "images:", images.length)
      studioThumbnails.setThumbnail(sid, pickThumbnail(images)!)
    }
  })
  // Global listener: update thumbnails when any session's generation completes,
  // regardless of which session is active. This covers the case where the user
  // switches sessions while a generation is in progress.
  const thumbnailUnsub = globalSDK.event.listen((event) => {
    const payload = event.details
    if (payload.type !== "message.part.updated") return
    const part = payload.properties.part as Part & { sessionID?: string }
    if (part.type !== "tool") return
    const state = part.state as { status?: string; output?: string; attachments?: Array<{ url: string; kind?: string }> }
    if (state.status !== "completed") return
    const sessionID = part.sessionID
    if (!sessionID) return
    const attachments = parseToolAttachments(part as Extract<Part, { type: "tool" }>)
    const images = parseToolImages(state.output ?? "")
    if (attachments.length === 0 && images.length === 0) return
    const url = attachments.length > 0
      ? (attachments.find((a) => a.kind !== "video") ?? attachments[0]).url
      : images[0]
    if (url) {
      console.log("[Thumbnail] Cross-session event setThumbnail for session", sessionID)
      studioThumbnails.setThumbnail(sessionID, url)
    }
  })
  onCleanup(thumbnailUnsub)

  let fileInputRef!: HTMLInputElement
  let videoFrameInputRef!: HTMLInputElement
  let pendingVideoFrameSlot: StudioVideoFrameSlot = "first"
  let conversationScrollRef!: HTMLDivElement
  let scrollFrame = 0
  // 用户是否贴近底部：贴近时新内容自动跟随滚动，向上查看历史时不再强制回到底部
  const [stickToBottom, setStickToBottom] = createSignal(true)
  const STUDIO_SCROLL_BOTTOM_THRESHOLD = 200
  const handleConversationScroll = () => {
    const el = conversationScrollRef
    if (!el) return
    setStickToBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - STUDIO_SCROLL_BOTTOM_THRESHOLD)
  }
  let pendingEditorSessionID: string | undefined
  let pendingGenerationSessionID: string | undefined
  // 记录已访问过的 session ID，模块级以在组件卸载/重载之间存活，防止切回时出现空白页
  const visitedSessionIds = new Set<string>()
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

  /** Pick the best thumbnail URL from a list of StudioImages. Prefers non-video images. */
  function pickThumbnail(images: StudioImage[]): string | undefined {
    const img = images.find((i) => !isVideoMedia(i)) ?? images[0]
    return img ? (img.thumbnailUrl ?? img.url) : undefined
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

  const [resizingLeft, setResizingLeft] = createSignal(false)
  const [resizingCenter, setResizingCenter] = createSignal(false)
  const [resizeState, setResizeState] = createStore({ startX: 0, startWidth: 0 })

  function onPagePointerMove(e: PointerEvent) {
    if (resizingLeft()) {
      const delta = e.clientX - resizeState.startX
      setStudioLeftWidth(Math.max(200, Math.min(360, resizeState.startWidth + delta)))
    }
    if (resizingCenter()) {
      const delta = e.clientX - resizeState.startX
      const pageWidth = studioPageRef?.clientWidth ?? window.innerWidth
      const leftW = studioLeftCollapsed() ? 68 : studioLeftWidth()
      const minCanvas = 800
      // 左增右剪，左减右增：center 最大 = min(700, 页面宽度 - 左侧面板 - canvas 最小宽度)
      const maxCenter = Math.min(700, pageWidth - leftW - minCanvas)
      setStudioCenterWidth(Math.min(maxCenter, Math.max(360, resizeState.startWidth + delta)))
    }
  }

  function onPagePointerUp() {
    if (resizingLeft()) {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setResizingLeft(false)
      setStudioLeftStore("width", studioLeftWidth())
    }
    if (resizingCenter()) {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setResizingCenter(false)
      setStudioCenterStore("width", studioCenterWidth())
    }
  }

  function handleStudioLeftResize(event: PointerEvent) {
    event.preventDefault()
    setResizeState({ startX: event.clientX, startWidth: studioLeftWidth() })
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    setResizingLeft(true)
  }

  // 窗口宽度（响应式追踪）
  const [windowWidth, setWindowWidth] = createSignal(window.innerWidth)

  // 折叠图标：窗口 ≥1456px 且 <1920px 时显示
  const [showToggleDrawer, setShowToggleDrawer] = createSignal(false)

  // 窗口 <1228px 时隐藏 studio-workspace，studio-center 始终可见
  const [showStudioWorkspace, setShowStudioWorkspace] = createSignal(true)
  createEffect(() => {
    const mql = window.matchMedia("(min-width: 1228px)")
    const update = () => setShowStudioWorkspace(mql.matches)
    update()
    mql.addEventListener("change", update)
    onCleanup(() => mql.removeEventListener("change", update))
  })

  // 窗口 <1228px 时 workspace 以抽屉形式悬浮
  const [studioWorkspaceOverlayOpen, setStudioWorkspaceOverlayOpen] = createSignal(false)

  // studio-center 样式：<1228px 铺满右侧，>=1228px 保持固定宽度
  const studioCenterStyle = createMemo(() => {
    if (!showStudioWorkspace()) {
      const leftW = studioLeftCollapsed() ? 68 : studioLeftWidth()
      const width = windowWidth() - leftW
      return { width: `${width}px`, flex: `0 0 ${width}px` }
    }
    return { width: `${studioCenterWidth()}px`, flex: `0 0 ${studioCenterWidth()}px` }
  })

  // studio-canvas 实际宽度（studio-center 始终可见）
  const canvasWidth = createMemo(() => {
    const leftW = studioLeftCollapsed() ? 68 : studioLeftWidth()
    const centerW = studioCenterWidth()
    return windowWidth() - leftW - centerW
  })

  // studio-canvas 实测宽度（ResizeObserver）：用于按宽度自动展开/收起详情面板
  const [studioCanvasEl, setStudioCanvasEl] = createSignal<HTMLElement | null>(null)
  const [studioCanvasWidth, setStudioCanvasWidth] = createSignal(0)
  createEffect(() => {
    const el = studioCanvasEl()
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setStudioCanvasWidth(entries[0]?.contentRect.width ?? 0)
    })
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })
  // studio-details 默认隐藏，仅由用户手动 toggle 展开/收起

  // 窗口 <1456px 时左侧栏以遮罩层形式展示
  const [studioLeftOverlayOpen, setStudioLeftOverlayOpen] = createSignal(false)
  const [isOverlayMode, setIsOverlayMode] = createSignal(false)
  createEffect(() => {
    const mql = window.matchMedia("(max-width: 1455px)")
    const update = () => {
      setIsOverlayMode(mql.matches)
      if (!mql.matches) setStudioLeftOverlayOpen(false)
    }
    update()
    mql.addEventListener("change", update)
    onCleanup(() => mql.removeEventListener("change", update))
  })

  // 窗口 <1456px 时左侧栏默认收缩
  createEffect(() => {
    const mql = window.matchMedia("(max-width: 1455px)")
    const update = () => setStudioLeftCollapsed(mql.matches)
    update()
    mql.addEventListener("change", update)
    window.addEventListener("resize", update)
    onCleanup(() => {
      mql.removeEventListener("change", update)
      window.removeEventListener("resize", update)
    })
  })

  // 自适应布局：
  //   ≥1920px:         left=296, center=(w-296)*29%, 限幅[360,700]
  //   1228px-1919px:   left=296, center=(w-296)*31%, 限幅[360,700]
  createEffect(() => {
    const mqlWide = window.matchMedia("(min-width: 1920px)")
    const mqlMedium = window.matchMedia("(min-width: 1456px) and (max-width: 1919px)")
    const mqlCenter31 = window.matchMedia("(min-width: 1228px) and (max-width: 1919px)")

    const calcCenterWidth = () => {
      setWindowWidth(window.innerWidth)
      if (mqlWide.matches) {
        const target = Math.round((window.innerWidth - 296) * 0.29)
        setStudioCenterWidth(Math.min(700, Math.max(360, target)))
      } else if (mqlCenter31.matches) {
        const target = Math.round((window.innerWidth - 296) * 0.31)
        setStudioCenterWidth(Math.min(700, Math.max(360, target)))
      }
    }

    const onMediaChange = () => {
      setShowToggleDrawer(mqlMedium.matches)
      if (mqlWide.matches || mqlMedium.matches) {
        if (!studioLeftCollapsed()) setStudioLeftWidth(296)
      }
      setWindowWidth(window.innerWidth)
      calcCenterWidth()
    }

    onMediaChange()
    mqlWide.addEventListener("change", onMediaChange)
    mqlMedium.addEventListener("change", onMediaChange)
    mqlCenter31.addEventListener("change", onMediaChange)
    window.addEventListener("resize", calcCenterWidth)
    onCleanup(() => {
      mqlWide.removeEventListener("change", onMediaChange)
      mqlMedium.removeEventListener("change", onMediaChange)
      mqlCenter31.removeEventListener("change", onMediaChange)
      window.removeEventListener("resize", calcCenterWidth)
    })
  })

  const centerResizeLeft = createMemo(() => {
    if (studioLeftCollapsed()) return 68
    return studioLeftWidth()
  })

  function handleStudioCenterResize(event: PointerEvent) {
    event.preventDefault()
    setResizeState({ startX: event.clientX, startWidth: studioCenterWidth() })
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    setResizingCenter(true)
  }

  const isBusy = createMemo(() =>
    sending() ||
    sessionStatus().type === "busy" ||
    pendingResult()?.status === "queued" ||
    pendingResult()?.status === "running"
  )
  const isActionBusy = createMemo(() => isBusy() || rebootingGenerationIDs().size > 0)
  const turns = createMemo(() =>
    buildStudioTurns({
      messages: params.id ? dataStore.message[params.id] ?? [] : [],
      parts: dataStore.part,
      fallback: pendingResult(),
      currentSessionID: params.id,
    }),
  )
  const displayTurns = createMemo(() =>
    (() => {
      const pending = pendingResult()
      const pendingTurnID = pending ? `studio_${pending.id}` : undefined
      const next = turns().map((turn) => {
        const normalized = turn.result ? { ...turn, result: normalizeResultValue(turn.result) } : turn
        if (!pending || normalized.id !== pendingTurnID && normalized.result?.id !== pending.id) return normalized
        const assistantText = pending.displayPrompt === STUDIO_REGENERATE_DISPLAY_PROMPT
          ? STUDIO_REGENERATE_ASSISTANT_TEXT
          : buildStudioThinkingText({
              capability: pending.capability,
              sourceImage: pending.sourceImage,
            })
        return {
          ...normalized,
          userText: pending.displayPrompt || normalized.userText,
          assistantText: pending.displayPrompt ? assistantText : normalized.assistantText || assistantText,
          toolError: undefined,
          toolTitle: studioGenerationTitle(pending.capability, isStudioGenerationFailure(pending.status) ? pending.status : pending.status === "succeeded" ? "succeeded" : "running"),
          toolName: `内部 · ${pending.status === "create_failed" ? "创建失败" : pending.status === "failed" ? "失败" : pending.status === "succeeded" ? "完成" : "生成中"}`,
          toolRunning: pending.status === "queued" || pending.status === "running",
          inputImages: pending.inputImages ?? normalized.inputImages,
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
      const pendingUserText = pending.displayPrompt || pending.prompt
      const pendingAssistantText = pending.displayPrompt === STUDIO_REGENERATE_DISPLAY_PROMPT
        ? STUDIO_REGENERATE_ASSISTANT_TEXT
        : buildStudioThinkingText({
            capability: pending.capability,
            sourceImage: pending.sourceImage,
          })
      const latest = next.at(-1)
      const pendingVisible = next.some((turn) => matchesPendingTurn(turn, pending))
      if (latest?.userText === pendingUserText && !latest.result?.images.length && latest.toolRunning) {
        if (isStudioGenerationFailure(pending.status)) {
          return mergeEditorEntries([
            ...next.slice(0, -1),
            {
              ...latest,
              userText: pendingUserText,
              assistantText: pendingAssistantText,
              toolError: undefined,
              toolTitle: studioGenerationTitle(pending.capability, pending.status),
              toolName: pending.status === "create_failed" ? "内部 · 创建失败" : "内部 · 失败",
              toolRunning: false,
              inputImages: pending.inputImages ?? latest.inputImages,
              result: normalizeResultValue(pending),
            },
          ])
        }
        if (pending.status !== "succeeded" || pending.images.length === 0) return mergeEditorEntries(next)
        return mergeEditorEntries([
          ...next.slice(0, -1),
          {
            ...latest,
            userText: pendingUserText,
            assistantText: pending.displayPrompt ? pendingAssistantText : latest.assistantText || pendingAssistantText,
            toolError: undefined,
            toolTitle: studioGenerationTitle(pending.capability, "succeeded"),
            toolName: "内部 · 完成",
            toolRunning: false,
            inputImages: pending.inputImages ?? latest.inputImages,
            result: normalizeResultValue(pending),
          },
        ])
      }
      if (pendingVisible) return mergeEditorEntries(next)
      if (!sending() && !isStudioGenerationFailure(pending.status) && next.length > 0 && !pending.displayPrompt) return mergeEditorEntries(next)
      return mergeEditorEntries([
        ...next,
        {
          id: pending.id,
          userText: pendingUserText,
          assistantText: pendingAssistantText,
          toolError: undefined,
          toolTitle: studioGenerationTitle(pending.capability, isStudioGenerationFailure(pending.status) ? pending.status : "running"),
          toolName: `内部 · ${pending.status === "create_failed" ? "创建失败" : pending.status === "failed" ? "失败" : "生成中"}`,
          toolRunning: pending.status === "queued" || pending.status === "running",
          inputImages: pending.inputImages,
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
  const defaultResult = createMemo(() => {
    const pending = pendingResult()
    if (
      pending &&
      !selectedResultId() &&
      (sending() || pending.status === "queued" || pending.status === "running")
    ) return pending

    const turn = studioTurn()
    // 跳过无图片的失败结果（包括用户取消生成），canvas 不应显示红色报错
    if (turn?.result && turn.result.images.length === 0 &&
        (turn.result.status === "failed" || turn.result.status === "create_failed")) {
      return latestCompletedTurn()?.result ?? pending
    }
    return turn?.result ?? latestCompletedTurn()?.result ?? pending
  })
  function isSamePendingTurn(turn: StudioTurnData | undefined, pending: StudioPendingResult) {
    return Boolean(turn && (turn.id === pending.id || turn.id === `studio_${pending.id}` || turn.result?.id === pending.id))
  }
  function matchesPendingTurn(turn: StudioTurnData | undefined, pending: StudioPendingResult) {
    if (isSamePendingTurn(turn, pending)) return true
    if (!pending.displayPrompt) return turn?.result?.prompt === pending.prompt
    if (pending.displayPrompt !== STUDIO_REGENERATE_DISPLAY_PROMPT) return false
    return Boolean(
      turn?.result &&
        (turn.userText === STUDIO_REGENERATE_DISPLAY_PROMPT || turn.result.displayPrompt === STUDIO_REGENERATE_DISPLAY_PROMPT) &&
        turn.result.prompt === pending.prompt &&
        turn.result.capability === pending.capability,
    )
  }
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
  // Keep showFileManager in sync with the persisted preference.
  // When the current session has no data, hide canvas/file-manager and show StudioIntro.
  // When switching sessions, default to the latest image tab (canvas).
  createEffect(() => {
    // 生成中时保持不变，避免文件管理覆盖 canvas 的 loading 状态
    if (isBusy()) return
    // 切换 session 时重置为默认显示图片/视频 tab
    if (params.id !== lastStudioSessionId) {
      lastStudioSessionId = params.id
      setStudioViewPref("mode", "canvas")
    }
    const hasImages = displayTurns().some((t) => (t.result?.images.length ?? 0) > 0)
    const hasData = displayTurns().length > 0 || pendingResult() || sending()
    if (!hasData || !hasImages) {
      // 无数据或无图片 → 显示 StudioIntro，隐藏 canvas 和文件管理
      setShowStudioCanvas(false)
      setShowFileManager(false)
      return
    }
    // 有数据且有图片 → 显示 canvas 区域，默认图片 tab
    setShowStudioCanvas(true)
    setShowFileManager(studioViewPref.mode === "file-manager")
  })

  const effectiveStatus = createMemo<StudioGenerationStatus>(() => {
    // isBusy 最优先，确保正在生成时显示 loading，而非被旧 result 的缓存图片掩盖
    // 但用户手动点击缩略图打开 canvas 时，显示已选图片而非 loading
    if (isBusy() && !(showStudioCanvas() && canvasResult()?.images.length)) return "running"
    if (canvasResult()?.images.length) return "succeeded"
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
    if (canvasTabTitle(r)) {
      const selected = r.images.findIndex((image) => image.id === selectedImageId())
      const labelIndex = selected !== -1 ? selected : 0
      setCanvasTabLabels((prev) => Object.fromEntries(
        Object.entries(prev).map(([id, label]) => {
          const index = r.images.findIndex((image) => image.id === id)
          return index === -1 ? [id, label] : [id, canvasTabLabel(r, labelIndex)]
        }),
      ))
    }
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
        setCanvasTabLabels({ [r.images[0].id]: canvasTabLabel(r) })
      } else {
        // 已有 tabs：追加，与 selectStudioImage 逻辑一致
        setCanvasTabImages((prev) => {
          if (prev.some((i) => i.id === r.images[0].id)) return prev
          return [...prev, r.images[0]]
        })
        setCanvasTabLabels((prev) => {
          if (prev[r.images[0].id]) return prev
          return { ...prev, [r.images[0].id]: canvasTabLabel(r) }
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

  function canvasTabLabel(result: StudioGenerationResult, imageIndex = 0) {
    const title = canvasTabTitle(result)
    return result.images.length > 1 ? `${title}-${imageIndex + 1}` : title
  }

  function canvasTabTitle(result: StudioGenerationResult) {
    if (result.capability === "image.upscale" || result.capability === "image.cutout") return capabilityLabel(result.capability)
    if (result.capability === "image.inpaint" || result.toolAction === "inpainting") return "智能重绘"
    if (result.capability === "image.outpaint" || result.toolAction === "outpainting") return "扩图"
    if (result.toolAction === "super_resolution") return "变清晰"
    if (result.toolAction === "cutout") return "抠图"
    return result.detailTitle ?? extractKeywords(result.prompt)
  }
  function selectStudioImage(input: { resultID: string; imageID: string }) {
    batch(() => {
      setSelectedResultId(input.resultID)
      const r = displayTurns().map((t) => t.result).find((item) => item?.id === input.resultID)
      if (!r) return
      if (!showStudioWorkspace()) setStudioWorkspaceOverlayOpen(true)
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
            [tabImg.id]: canvasTabLabel(r, imageIndex),
          }))
        }
        setDeletedImageIds(new Set<string>())
        setWorkspaceImage(undefined)
        setWorkspaceUploadRequested(false)
        setShowFileManager(false)
        setStudioViewPref("mode", "canvas")
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
        setCanvasTabLabels((prev) => ({ ...prev, [first.id]: canvasTabLabel(r, imageIndex) }))
        setDeletedImageIds(new Set<string>())
        setWorkspaceImage(undefined)
        setWorkspaceUploadRequested(false)
        setShowFileManager(false)
        setStudioViewPref("mode", "canvas")
        setMode("preview")
      }
    })
  }

  function selectFileManagerMedia(input: { resultID: string; imageID: string }) {
    fileManagerDetailResultId = input.resultID
    fileManagerDetailImageId = input.imageID
    batch(() => {
      setShowStudioCanvas(true)
      setShowFileManager(true)
      setFileManagerDetailView(true)
      setSelectedResultId(input.resultID)
      setSelectedImageId(input.imageID)
      setDeletedImageIds(new Set<string>())
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("preview")
    })
  }

  function backFromFileManagerDetail() {
    setFileManagerGenPending(false)
    setFileManagerDetailView(false)
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
      setShowFileManager(false)
      setStudioViewPref("mode", "canvas")
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
        // 最后一个 tab：切换到文件管理，清除选中避免 fallback 重新创建 tab
        setSelectedResultId(undefined)
        setSelectedImageId(undefined)
        setShowStudioCanvas(true)
        setShowFileManager(true)
        setFileManagerDetailView(false)
        setStudioViewPref("mode", "file-manager")
      }
    })
  }

  createEffect(() => {
    const pending = pendingResult()
    if (!pending) return
    const turn = studioTurn()
    if (!matchesPendingTurn(turn, pending)) return
    if (isStudioGenerationFailure(pending.status) && turn?.toolRunning) return
    if (pending.status === "succeeded" && pending.images.length > 0 && turn?.toolRunning) return
    if (turn?.result?.status === "queued" || turn?.result?.status === "running") {
      const next = turn.result
      if (isStudioGenerationStatusRegression(pending.status, next.status)) return
      setPendingResult((current) => {
        if (!current || current.status === next.status && current.progress === next.progress && current.order === next.order) return current
        return { ...current, ...next, displayPrompt: current.displayPrompt ?? next.displayPrompt, detailPrompt: current.detailPrompt ?? next.detailPrompt, sourceImage: current.sourceImage, inputImages: current.inputImages }
      })
      setStatus(next.status)
      return
    }
    if (!turn?.result && !turn?.toolError) return
    // Save thumbnail before clearing pendingResult — check both pending and turn for images
    const images = (pending.images?.length ? pending.images : turn?.result?.images) ?? []
    if (images.length > 0) {
      const sid = pending.sessionID ?? params.id
      if (sid) {
        console.log("[Thumbnail] Sync-effect setThumbnail for session", sid, "images:", images.length)
        studioThumbnails.setThumbnail(sid, pickThumbnail(images)!)
      }
    }
    setPendingResult(undefined)
    setStatus(turn.result?.status ?? (turn.toolError ? "failed" : "succeeded"))
  })

  createEffect(() => {
    const pending = pendingResult()
    if (!pending || sending()) return
    if (sessionStatus().type !== "idle") return
    const turn = studioTurn()
    if (!matchesPendingTurn(turn, pending)) return
    if (turn?.result?.images.length) {
      const sid = pending.sessionID ?? params.id
      if (sid) {
        console.log("[Thumbnail] Sync-effect-2 setThumbnail for session", sid)
        studioThumbnails.setThumbnail(sid, pickThumbnail(turn!.result!.images)!)
      }
      setPendingResult(undefined)
      setStatus("succeeded")
      return
    }
    if (turn?.result?.status === "queued" || turn?.result?.status === "running") {
      const next = turn.result
      if (isStudioGenerationStatusRegression(pending.status, next.status)) return
      setPendingResult((current) => {
        if (!current || current.status === next.status && current.progress === next.progress && current.order === next.order) return current
        return { ...current, ...next, displayPrompt: current.displayPrompt ?? next.displayPrompt, detailPrompt: current.detailPrompt ?? next.detailPrompt, sourceImage: current.sourceImage, inputImages: current.inputImages }
      })
      setStatus(next.status)
      return
    }
    if (pending.status === "succeeded" && pending.images.length > 0 && turn?.toolRunning) {
      setStatus("succeeded")
      return
    }
    if (isStudioGenerationFailure(pending.status) && turn?.toolRunning) {
      setStatus(pending.status)
      return
    }
    if (!turn?.toolError && !turn?.assistantText) return
    setPendingResult(undefined)
    setStatus(turn?.result?.status ?? "failed")
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
        // Clear pendingResult when switching to an unrelated session, even
        // when sending() is still true (the pending result is scoped to the
        // previous session and should not ghost into the new one).
        if (id && !preserveGenerationCapability && pendingResult()?.sessionID !== id) {
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
        // 标记已访问，用于区分「加载中」和「空 session」
        if (id) visitedSessionIds.add(id)
        // 无图片数据时直接显示文件管理，避免展示空 canvas / 生成中 loading
        // 但如果 session 完全没有数据，显示 StudioIntro
        const sessionTurns = id ? buildStudioTurns({
          messages: dataStore.message[id] ?? [],
          parts: dataStore.part,
          currentSessionID: id,
        }) : []
        const hasImages = (() => {
          const latest = [...sessionTurns].reverse().find((t) => (t.result?.images.length ?? 0) > 0)
          return (latest?.result?.images.length ?? 0) > 0
        })()
        const hasData = sessionTurns.length > 0 || pendingResult() || sending()
        if (!hasData || !hasImages) {
          // 无数据或无图片 → 显示 StudioIntro
          setShowStudioCanvas(false)
          setShowFileManager(false)
        } else {
          // 有数据且有图片 → 默认图片 tab
          setShowStudioCanvas(true)
          setShowFileManager(studioViewPref.mode === "file-manager")
        }
        setFileManagerDetailView(false)
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
  function resultRequiresSeedreamPermission(item?: StudioGenerationResult) {
    return Boolean(item?.capability === "image.generate" && styleModelRequiresSeedreamPermission(item.styleModel ?? item.model))
  }
  function resultRegenerateDisabled(item?: StudioGenerationResult) {
    return isActionBusy() || Boolean(item?.capability === "video.generate" && !canGenerateVideo()) || Boolean(resultRequiresSeedreamPermission(item) && !canUseSeedream())
  }
  const hasVideoFrames = createMemo(() => hasVideoFrameAssets(videoFrames))
  const hasInvalidVideoFrames = createMemo(() => Boolean(videoFrames.last && !videoFrames.first))
  const videoQualityLocked = createMemo(() => Boolean(videoFrames.first && videoFrames.last))
  createEffect(() => {
    if (videoQualityLocked()) setVideoQualityMode("pro")
  })
  const canSubmit = createMemo(() =>
    SUPPORTED_STUDIO_CAPABILITIES.has(capability()) &&
    !isActionBusy() &&
    !selectedCapabilityNeedsImage() &&
    (capability() !== "image.generate" || canUseSeedream() || !styleModelRequiresSeedreamPermission(styleModel())) &&
    (
      capability() === "video.generate"
        ? !hasInvalidVideoFrames() && (prompt().trim().length > 0 || hasVideoFrames())
        : prompt().trim().length > 0
    ),
  )
  const isEditingWorkspaceMode = createMemo(() => mode() !== "preview")
  const currentTitle = createMemo(() =>
    sessionTitle(activeStudioSession()?.title) ??
    (result()?.detailTitle ?? (result()?.prompt
      ? buildStudioDisplayPrompt(result()!.prompt)
      : studioTurn()?.userText || "Octo Studio")),
  )
  const [headerTitle, setHeaderTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    saving: false,
  })
  let headerTitleRef: HTMLInputElement | undefined
  const [isHeaderTruncated, setIsHeaderTruncated] = createSignal(false)
  let headerSpanRef!: HTMLSpanElement
  let headerResizeObserver: ResizeObserver | undefined
  const checkHeaderTruncation = () => {
    if (headerSpanRef) setIsHeaderTruncated(headerSpanRef.scrollWidth > headerSpanRef.clientWidth)
  }
  onCleanup(() => headerResizeObserver?.disconnect())
  createEffect(() => {
    const _title = currentTitle()
    void _title
    queueMicrotask(() => checkHeaderTruncation())
  })
  const [showHeaderTooltip, setShowHeaderTooltip] = createSignal(false)
  let headerTooltipTimeout: ReturnType<typeof setTimeout> | undefined
  let headerTooltipRef!: HTMLDivElement
  const [headerTooltipStyle, setHeaderTooltipStyle] = createSignal<JSX.CSSProperties>({})
  const updateHeaderTooltipPos = () => {
    if (!headerSpanRef) return
    const rect = headerSpanRef.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const style: JSX.CSSProperties = { left: `${rect.left}px` }
    if (spaceBelow >= 130 || spaceBelow >= rect.top) {
      style.top = `${rect.bottom + 4}px`
    } else {
      style.bottom = `${window.innerHeight - rect.top + 4}px`
    }
    setHeaderTooltipStyle(style)
  }
  const enterHeaderTrigger = () => {
    if (!isHeaderTruncated()) return
    clearTimeout(headerTooltipTimeout)
    updateHeaderTooltipPos()
    setShowHeaderTooltip(true)
  }
  const leaveHeaderTrigger = () => {
    headerTooltipTimeout = setTimeout(() => setShowHeaderTooltip(false), 150)
  }
  const enterHeaderTooltip = () => clearTimeout(headerTooltipTimeout)
  const leaveHeaderTooltip = () => setShowHeaderTooltip(false)

  // 菜单打开时关闭浮层侧边栏、清除 overflow 避免裁剪 Portal 内容
  createEffect(() => {
    if (headerTitle.menuOpen) {
      setStudioLeftOverlayOpen(false)
      studioPageRef.style.overflow = "visible"
    } else {
      studioPageRef.style.overflow = ""
    }
  })

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
    // session 可能不在 syncStore 中，用 currentTitle() 兜底
    const draft = session
      ? (sessionTitle(session.title) ?? "")
      : currentTitle()
    setHeaderTitle({ editing: true, draft })
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
    const sessionId = session?.id ?? params.id
    if (!sessionId || headerTitle.saving) return

    const next = headerTitle.draft.trim()
    const oldTitle = session
      ? (sessionTitle(session.title) ?? "")
      : currentTitle()
    if (!next || next === oldTitle) {
      setHeaderTitle({ editing: false, draft: "" })
      return
    }

    setHeaderTitle("saving", true)
    await globalSDK.createClient({ directory: projectDir() }).session
      .update({ sessionID: sessionId, title: next })
      .then(() => {
        setSyncStore(
          produce((draft) => {
            const index = draft.session.findIndex((item) => item.id === sessionId)
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
    const listResult = await globalSDK.createClient({ directory: projectDir() }).session.list()
    const sessions = ((listResult.data ?? []) as Session[])
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

    studioThumbnails.removeThumbnail(session.id)

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
      (next, prev) => {
        if (!params.id || !conversationScrollRef) return
        const sessionChanged = prev == null || next.slice(0, next.indexOf(":")) !== prev.slice(0, prev.indexOf(":"))
        // 生成中/排队中不自动滚动，保留用户滚动条位置；完成后贴近底部时才跟随
        if (!sessionChanged && isBusy()) return
        if (!sessionChanged && !stickToBottom()) return
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          conversationScrollRef.scrollTo({ top: conversationScrollRef.scrollHeight })
        })
      },
      { defer: true },
    ),
  )

  // 生成完成（busy→idle）：滚动到底部展示新结果。
  // 独立监听 isBusy 以覆盖内容变更先于 session 状态置 idle 到达的时序。
  // 成功后默认置底（无论用户生成中是否上滑查看历史）。
  createEffect(
    on(
      isBusy,
      (busy, prev) => {
        if (!params.id || !conversationScrollRef) return
        if (!(prev && !busy)) return
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

  function resolveStudioImageFetchUrl(url: string) {
    if (url.startsWith("data:image/") || /^https?:\/\//i.test(url)) return url
    const artifact = getArtifactRelativePath(url)
    if (!artifact) return url
    return getArtifactServeUrl(globalSDK.url, projectDir(), artifact.sessionId, artifact.relativePath)
  }

  async function resolveImageUrlDataUrl(url: string) {
    if (url.startsWith("data:image/")) return url
    const response = await fetch(resolveStudioImageFetchUrl(url))
    if (!response.ok) throw new Error(`Unable to load selected image. status=${response.status}`)
    const blob = await response.blob()
    if (!blob.type.startsWith("image/")) throw new Error(`Selected media is not an image. content-type=${blob.type || "unknown"}`)
    return readBlobAsDataUrl(blob)
  }

  async function resolveImageDataUrl(image: StudioImage) {
    return resolveImageUrlDataUrl(image.remoteUrl ?? image.url)
  }

  function dataUrlByteSize(dataUrl: string) {
    const content = dataUrl.match(/^data:[^;,]+;base64,(.*)$/)?.[1]
    if (!content) return new Blob([dataUrl]).size
    const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0
    return Math.floor(content.length * 3 / 4) - padding
  }

  function mimeFromDataUrl(dataUrl: string) {
    return dataUrl.match(/^data:([^;,]+);base64,/)?.[1] ?? "image/png"
  }

  async function inputImageAssetFromUrl(url: string) {
    const dataUrl = await resolveImageUrlDataUrl(url)
    const mime = mimeFromDataUrl(dataUrl)
    return {
      id: crypto.randomUUID(),
      name: `reference-image.${studioImageExtension(mime)}`,
      mime,
      dataUrl,
    }
  }

  async function validateVideoFrameAsset(asset: StudioAsset) {
    if (!asset.mime.startsWith("image/")) throw new Error("请上传图片文件。")
    if (dataUrlByteSize(asset.dataUrl) > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB。")
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
  }

  async function validateVideoFrame(file: File) {
    if (!file.type.startsWith("image/")) throw new Error("请上传图片文件。")
    if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB。")
    const asset = await readStudioAsset(file)
    await validateVideoFrameAsset(asset)
    return asset
  }

  const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const

  function readStudioAssetDimensions(asset: StudioAsset) {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error("无法读取图片尺寸。"))
      img.src = asset.dataUrl
    })
  }

  function selectStyleModel(value: string) {
    // 切换 Seedream 与其他模型时清空自定义尺寸（校验规则不同）
    const prevIsSeedream = styleModelRequiresSeedreamPermission(styleModel())
    const nextIsSeedream = styleModelRequiresSeedreamPermission(value)
    if (prevIsSeedream !== nextIsSeedream) {
      setIsCustomStore(false)
      setCustomWidth(0)
      setCustomHeight(0)
    } else if (isCustomStore()) {
      // 非 Seedream 模型间切换时，根据新模型的临界值钳位自定义尺寸
      const prevIsQwen = styleModel() === "qwen"
      const nextIsQwen = value === "qwen"
      if (!prevIsQwen && nextIsQwen) {
        // 从其他模型切到千问：钳位到千问上限 1664
        setCustomWidth(Math.min(customWidth(), 1664))
        setCustomHeight(Math.min(customHeight(), 1664))
      }
    }
    setStyleModel(value)
    setAssets((items) => items.slice(0, referenceImageLimit(value)))
  }

  async function addReferenceAsset(asset: StudioAsset) {
    const limit = maxReferenceImages()
    if (limit !== 1 && assets().length >= limit) {
      showFloatingNotice("error", `上传失败：最多上传 ${limit} 张参考图。`)
      return
    }
    const isJimeng = imageTool() === "jimeng"
    const allowedExts = isJimeng ? ["png", "jpg", "jpeg"] : (ALLOWED_IMAGE_EXTENSIONS as readonly string[])
    const ext = studioImageExtension(asset.mime)
    if (!allowedExts.includes(ext)) {
      showFloatingNotice("error", `上传失败：${isJimeng ? "仅支持 .png、.jpg、.jpeg 格式文件。" : "仅支持 .png、.jpg、.jpeg、.webp 格式文件。"}`)
      return
    }
    const maxSize = isJimeng ? 15 * 1024 * 1024 : 8 * 1024 * 1024
    const maxSizeLabel = isJimeng ? "15MB" : "8MB"
    if (dataUrlByteSize(asset.dataUrl) > maxSize) {
      showFloatingNotice("error", `上传失败：图片文件大小不能超过 ${maxSizeLabel}。`)
      return
    }
    const dimensions = await readStudioAssetDimensions(asset)
    if (dimensions.width > 7500 || dimensions.height > 7500) {
      showFloatingNotice("error", "上传失败：图片最大尺寸不能超过 7500px。")
      return
    }
    tracker.interaction({ module: "studio", name: "add-attachment", extend: JSON.stringify({ count: 1 }) })
    setAssets((current) => limit === 1 ? [asset] : [...current, asset].slice(0, limit))
  }

  function nextVideoFrameSlot() {
    if (!videoFrames.first) return "first"
    if (!videoFrames.last) return "last"
    return "last"
  }

  async function addVideoFrameAsset(asset: StudioAsset) {
    await validateVideoFrameAsset(asset)
    setVideoFrames(nextVideoFrameSlot(), asset)
  }

  function useConversationInputImage(url: string) {
    if (capability() !== "image.generate" && capability() !== "video.generate") return
    inputImageAssetFromUrl(url)
      .then((asset) => capability() === "video.generate" ? addVideoFrameAsset(asset) : addReferenceAsset(asset))
      .catch((error) => {
        showFloatingNotice("error", `上传失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }

  function addAssets(files: File[]) {
    const imageFiles = files.filter((item) => item.type.startsWith("image/"))
    if (!imageFiles.length) return
    const limit = maxReferenceImages()
    const selectedFiles = limit === 1 ? imageFiles.slice(0, 1) : imageFiles.slice(0, Math.max(limit - assets().length, 0))
    if (!selectedFiles.length) {
      showFloatingNotice("error", `上传失败：最多上传 ${limit} 张参考图。`)
      return
    }
    const isJimeng = imageTool() === "jimeng"
    const allowedExts = isJimeng ? ["png", "jpg", "jpeg"] : (ALLOWED_IMAGE_EXTENSIONS as readonly string[])
    const invalidExtFile = selectedFiles.find((file) => !allowedExts.includes(file.name.split(".").pop()?.toLowerCase() ?? ""))
    if (invalidExtFile) {
      showFloatingNotice("error", `上传失败：${isJimeng ? "仅支持 .png、.jpg、.jpeg 格式文件。" : "仅支持 .png、.jpg、.jpeg、.webp 格式文件。"}`)
      return
    }
    const maxSize = isJimeng ? 15 * 1024 * 1024 : 8 * 1024 * 1024
    const maxSizeLabel = isJimeng ? "15MB" : "8MB"
    if (selectedFiles.some((file) => file.size > maxSize)) {
      showFloatingNotice("error", `上传失败：图片文件大小不能超过 ${maxSizeLabel}。`)
      return
    }
    tracker.interaction({ module: "studio", name: "add-attachment", extend: JSON.stringify({ count: selectedFiles.length }) })
    Promise.all(selectedFiles.map((file) => readStudioAsset(file).then((asset) => readStudioAssetDimensions(asset).then((dimensions) => ({ asset, dimensions })))))
      .then((items) => {
        if (items.some((item) => item.dimensions.width > 7500 || item.dimensions.height > 7500)) {
          showFloatingNotice("error", "上传失败：图片最大尺寸不能超过 7500px。")
          return
        }
        setAssets((current) => limit === 1 ? [items[0].asset] : [...current, ...items.map((item) => item.asset)].slice(0, limit))
      })
      .catch((error) => {
        showFloatingNotice("error", `上传失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }

  function addVideoFrame(slot: StudioVideoFrameSlot, files: File[]) {
    const file = files.find((item) => item.type.startsWith("image/"))
    if (!file) return
    validateVideoFrame(file)
      .then((asset) => setVideoFrames(slot, asset))
      .catch((error) => {
        showFloatingNotice("error", `上传失败：${error instanceof Error ? error.message : String(error)}`)
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
      showFloatingNotice("error", `上传失败：${isJimeng ? "仅支持 .png、.jpg、.jpeg 格式文件。" : "仅支持 .png、.jpg、.jpeg、.webp 格式文件。"}`)
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
      showFloatingNotice("error", `上传失败：图片文件大小不能超过 ${maxSizeLabel}。`)
      return
    }
    readWorkspaceImage(file)
      .then((image) => {
        if (image.width != null && image.height != null) {
          if (image.width > 7500 || image.height > 7500) {
            showFloatingNotice("error", "上传失败：图片最大尺寸不能超过 7500px。")
            return
          }
          const minSide = capability() === "image.cutout" ? 50 : isStrictEdit ? 300 : 0
          if (minSide > 0 && Math.min(image.width, image.height) < minSide) {
            showFloatingNotice("error", `上传失败：图片最小边不能小于 ${minSide}px。`)
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
        showFloatingNotice("error", `上传失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }

  function deleteWorkspaceImage() {
    // 从文件管理详情页进入编辑器的，关闭时恢复文件管理详情视图
    if (fileManagerDetailView()) {
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
      if (!showStudioWorkspace()) setStudioWorkspaceOverlayOpen(true)
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
      ...directoryHeader(projectDir()),
      ...modelsApiHeaders(),
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
        showFloatingNotice("error", `入口消息保存失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }

  function applyStudioCapability(value: StudioCapability) {
    setCapability(value)
    if (value === "video.generate") {
      setAspectRatio("1:1")
      setCount(1)
    }
    if (value !== "video.generate") clearVideoFrames()
    if (value !== "image.generate") {
      setAssets([])
      // 切换到非图片生成模式时清空自定义尺寸，避免带入视频/编辑模式
      setIsCustomStore(false)
      setCustomWidth(0)
      setCustomHeight(0)
    }
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
        showFloatingNotice("error", `图片处理失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }

  function startNewStudioConversation() {
    tracker.interaction({ module: "studio", name: "new-session" })
    pendingVideoFirstFrame = undefined
    pendingEditorSessionID = undefined
    pendingGenerationSessionID = undefined
    generationToken++
    setVideoRiskDialogOpen(false)
    setVideoRiskConfirmedSessionID(undefined)
    setDraftVideoRiskConfirmed(false)
    setStatus("idle")
    setPendingResult(undefined)
    setSending(false)
    setPendingEditorEntries([])
    setMode("preview")
    setCapability("image.generate")
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

  function buildStudioThinkingText(input: { capability: StudioCapability; sourceImage?: string }) {
    if (input.capability === "image.upscale") return "好的，我将提升当前图片的清晰度和细节。"
    if (input.capability === "image.inpaint") return "好的，我将根据涂抹区域局部重绘当前图片。"
    if (input.capability === "image.outpaint") return "好的，我将扩展当前图片。"
    if (input.capability === "video.generate") return "好的，我将为您生成一段视频。"
    if (input.sourceImage) return "好的，我会基于当前画面继续创作。"
    return `好的，我将为您生成${capabilityLabel(input.capability)}。`
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
      const refinedPrompt = stringValue(input, "refinedPrompt")
      const originalPrompt = stringValue(input, "prompt")
      const effectivePrompt = stringValue(input, "effectivePrompt") ?? refinedPrompt ?? result.prompt
      return {
        capability: result.capability,
        prompt: effectivePrompt ?? refinedPrompt ?? originalPrompt ?? result.prompt,
        displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
        detailPrompt: result.detailPrompt,
        detailTitle: result.detailTitle,
        refinedPrompt,
        effectivePrompt,
        referenceImages: stringArrayValue(recordValue(input, "referenceImages")),
        extra: { ...(extra ?? {}), skipPromptRefine: true },
        videoFrames: restoredVideoFrames(result),
        aspectRatio: nextAspectRatio,
        count: nextCount,
        width: result.width,
        height: result.height,
        videoDuration: videoDurationValue(recordValue(extra, "duration")) ?? result.duration,
        videoQualityMode: videoQualityModeValue(recordValue(extra, "mode")) ?? result.videoQualityMode,
        useRestoredInputs: true,
      }
    }
    if (result.capability === "image.generate") {
      const refinedPrompt = stringValue(input, "refinedPrompt")
      const originalPrompt = stringValue(input, "prompt")
      const effectivePrompt = stringValue(input, "effectivePrompt") ?? refinedPrompt ?? (result.displayPrompt && result.prompt === result.displayPrompt ? undefined : result.prompt)
      return {
        capability: result.capability,
        prompt: effectivePrompt ?? refinedPrompt ?? originalPrompt ?? result.prompt,
        displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
        detailPrompt: result.detailPrompt,
        detailTitle: result.detailTitle,
        refinedPrompt,
        effectivePrompt,
        referenceImages: stringArrayValue(recordValue(input, "referenceImages")),
        extra: { ...(extra ?? {}), skipPromptRefine: true },
        styleModel: styleModelId(stringValue(input, "styleModel")),
        aspectRatio: nextAspectRatio,
        count: nextCount,
        width: result.width,
        height: result.height,
        useRestoredInputs: true,
      }
    }
    const refinedPrompt = stringValue(input, "refinedPrompt")
    const originalPrompt = stringValue(input, "prompt")
    const effectivePrompt = stringValue(input, "effectivePrompt") ?? refinedPrompt ?? result.prompt
    return {
      capability: result.capability,
      prompt: effectivePrompt ?? refinedPrompt ?? originalPrompt ?? result.prompt,
      displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
      detailPrompt: result.detailPrompt,
      detailTitle: result.detailTitle,
      refinedPrompt,
      effectivePrompt,
      sourceImage: stringValue(input, "sourceImage"),
      extra: { ...(extra ?? {}), skipPromptRefine: true },
      aspectRatio: nextAspectRatio,
      count: nextCount,
      width: result.width,
      height: result.height,
      useRestoredInputs: true,
    }
  }

  function restoreGenerationEditDraft(result: StudioGenerationResult) {
    const input = inputRecord(result)
    const extra = inputExtraRecord(result)
    const nextAspectRatio = aspectRatioValue(recordValue(input, "aspectRatio")) ?? result.aspectRatio
    const nextCount = countValue(recordValue(input, "count")) ?? (result.images.length >= 1 && result.images.length <= 4 ? result.images.length as 1 | 2 | 3 | 4 : undefined)
    return {
      capability: result.capability,
      prompt: stringValue(input, "prompt") ?? result.displayPrompt ?? result.prompt,
      styleModel: styleModelId(stringValue(input, "styleModel") ?? result.styleModel ?? result.model),
      aspectRatio: nextAspectRatio,
      count: nextCount,
      width: result.width,
      height: result.height,
      referenceImages: stringArrayValue(recordValue(input, "referenceImages")),
      videoFrames: restoredVideoFrames(result),
      videoDuration: videoDurationValue(recordValue(extra, "duration")) ?? result.duration,
      videoQualityMode: videoQualityModeValue(recordValue(extra, "mode")) ?? result.videoQualityMode,
    }
  }

  function canEditGenerationDraft(draft: ReturnType<typeof restoreGenerationEditDraft>) {
    if (draft.capability === "video.generate" && !canGenerateVideo()) {
      showFloatingNotice("warning", "暂无视频生成权限：当前账号无法重新编辑该视频生成任务。")
      return false
    }
    if (
      draft.capability === "image.generate" &&
      draft.styleModel &&
      styleModelRequiresSeedreamPermission(draft.styleModel) &&
      !canUseSeedream()
    ) {
      showFloatingNotice("warning", "暂无模型使用权限：当前账号无法重新编辑该图片生成任务。")
      return false
    }
    return true
  }

  function showEditDraftSyncedToast() {
    showFloatingNotice("info", "已经同步参数到左侧输入区")
  }

  async function studioAssetFromImageUrl(url: string, name: string): Promise<StudioAsset> {
    return {
      id: crypto.randomUUID(),
      name,
      mime: "image/png",
      dataUrl: await resolveImageUrlDataUrl(url),
    }
  }

  async function restoredImageAssets(referenceImages: string[], limit: number) {
    return (await Promise.all(referenceImages.slice(0, limit).map((referenceImage, index) =>
      studioAssetFromImageUrl(referenceImage, `reference-${index + 1}.png`).catch((error) => {
        console.warn("[StudioPage] restore edit draft reference image failed", error)
        return undefined
      })
    ))).filter((asset): asset is StudioAsset => Boolean(asset))
  }

  async function restoredVideoFrameAssets(frames: { first?: string; last?: string }) {
    const first = frames.first
      ? await studioAssetFromImageUrl(frames.first, "first-frame.png").catch((error) => {
          console.warn("[StudioPage] restore edit draft first frame failed", error)
          return undefined
        })
      : undefined
    const last = frames.last
      ? await studioAssetFromImageUrl(frames.last, "last-frame.png").catch((error) => {
          console.warn("[StudioPage] restore edit draft last frame failed", error)
          return undefined
        })
      : undefined
    return { first, last }
  }

  async function editGenerationDraft(result: StudioGenerationResult) {
    if (isActionBusy()) return
    if (result.capability !== "image.generate" && result.capability !== "video.generate") return
    const draft = restoreGenerationEditDraft(result)
    if (!canEditGenerationDraft(draft)) return
    batch(() => {
      setOpenMenu(null)
      setMode("preview")
      setStudioWorkspaceOverlayOpen(false)
      setCapability(draft.capability)
      setPrompt(draft.prompt)
      setAspectRatio(draft.aspectRatio)
      if (draft.count) setCount(draft.count)
      if (draft.width) setCustomWidth(draft.width)
      if (draft.height) setCustomHeight(draft.height)
      setIsCustomStore(Boolean(draft.width && draft.height))
    })
    tracker.interaction({
      module: "studio",
      name: "edit-generation-draft",
      extend: JSON.stringify({
        capability: result.capability,
        aspectRatio: result.aspectRatio,
        count: result.images.length,
        hasReferenceImage: draft.referenceImages.length > 0 || Boolean(draft.videoFrames.first || draft.videoFrames.last),
      }),
    })
    if (draft.capability === "image.generate") {
      if (draft.styleModel) setStyleModel(draft.styleModel)
      clearVideoFrames()
      setAssets(await restoredImageAssets(draft.referenceImages, referenceImageLimit(draft.styleModel ?? styleModel())))
      showEditDraftSyncedToast()
      return
    }
    setAssets([])
    if (draft.videoDuration) setVideoDuration(draft.videoDuration)
    if (draft.videoQualityMode) setVideoQualityMode(draft.videoQualityMode)
    replaceVideoFrames(await restoredVideoFrameAssets(draft.videoFrames))
    showEditDraftSyncedToast()
  }

  async function createStudioGeneration(input: {
    sessionID: string
    text: string
    displayPrompt?: string
    detailPrompt?: string
    detailTitle?: string
    initialSessionTitle?: string
    shouldSetSessionTitle?: boolean
    capability: StudioCapability
    styleModel?: string
    aspectRatio?: StudioAspectRatio
    width?: number
    height?: number
    count?: 1 | 2 | 3 | 4
    referenceImages?: string[]
    sourceImage?: string
    refinedPrompt?: string
    effectivePrompt?: string
    extra?: Record<string, unknown>
  }, signal?: AbortSignal) {
    const current = server.current
    if (!current) throw new Error("No active server.")
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...directoryHeader(projectDir()),
      ...modelsApiHeaders(),
    }
    if (current.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const controller = new AbortController()
    const abortSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
    const timeout = setTimeout(() => controller.abort(), STUDIO_GENERATION_CREATE_TIMEOUT_MS)
    const response = await fetch(new URL("/studio/generations", current.http.url), {
      method: "POST",
      headers,
      signal: abortSignal,
      body: JSON.stringify({
        sessionID: input.sessionID,
        capability: input.capability,
        prompt: input.text,
        displayPrompt: input.displayPrompt,
        detailPrompt: input.detailPrompt,
        detailTitle: input.detailTitle,
        initialSessionTitle: input.initialSessionTitle,
        shouldSetSessionTitle: input.shouldSetSessionTitle,
        refinedPrompt: input.refinedPrompt,
        effectivePrompt: input.effectivePrompt,
        promptRefineModels: models
          .list()
          .filter((model) =>
            models.visible({
              providerID: model.provider.id,
              modelID: model.id,
            }),
          )
          .map((model) => ({
            providerID: model.provider.id,
            modelID: model.id,
          })),
        styleModel: input.capability === "image.generate" ? input.styleModel ?? styleModel() : undefined,
        aspectRatio: (input.width && input.height)
          ? undefined
          : input.capability === "image.generate" || input.capability === "video.generate"
            ? input.aspectRatio ?? aspectRatio()
            : input.aspectRatio,
        count: input.capability === "image.generate" || input.capability === "video.generate" ? input.count ?? count() : undefined,
        isCustom: Boolean(input.width && input.height),
        ...(input.width && input.height ? { target_size: { width: input.width, height: input.height } } : {}),
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

  async function generatePromptFromReferenceImage(base64img: string, signal?: AbortSignal) {
    const current = server.current
    if (!current) throw new Error("No active server.")
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...directoryHeader(projectDir()),
    }
    if (current.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const response = await fetch(new URL("/studio/prompt-gen", current.http.url), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ base64img }),
    })
    const bodyText = await response.text()
    if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
    const result = JSON.parse(bodyText) as StudioPromptGenResponse
    if (result.resp_code !== 200) throw new Error(result.resp_msg?.trim() || "提示词生成失败")
    const zh = result.result?.zh?.trim()
    if (!zh) throw new Error("提示词生成结果为空")
    return zh
  }

  async function handleReversePrompt() {
    const asset = assets()[0]
    if (!asset) {
      showFloatingNotice("warning", "请先上传参考图")
      return
    }
    if (reversePromptRunning) return

    tracker.interaction({ module: "studio", name: "reverse-prompt-click" })
    reversePromptRunning = true
    const controller = new AbortController()
    reversePromptController = controller
    const dismissNotice = showFloatingNotice({
      type: "info",
      message: "提示词正在生成中",
      icon: "loading",
      duration: 0,
      action: {
        label: "取消",
        onClick: () => {
          reversePromptController?.abort()
          reversePromptRunning = false
          dismissNotice()
        },
      },
    })

    try {
      const zh = await generatePromptFromReferenceImage(asset.dataUrl, controller.signal)
      if (controller.signal.aborted || !reversePromptRunning) return
      setPrompt(zh)
      dismissNotice()
      showFloatingNotice("success", "反推结果已置入画板")
    } catch (error) {
      if (controller.signal.aborted || !reversePromptRunning) return
      dismissNotice()
      showFloatingNotice("error", error instanceof Error ? error.message : String(error))
    } finally {
      if (reversePromptController === controller) reversePromptController = undefined
      if (!controller.signal.aborted) reversePromptRunning = false
    }
  }

  function studioImageDataUrlPayload(value: string) {
    const match = value.match(/^data:([^;,]+);base64,(.*)$/)
    return {
      mime: match?.[1] ?? "image/png",
      content: match?.[2] ?? value,
    }
  }

  function studioImageExtension(mime: string) {
    if (mime === "image/jpeg") return "jpg"
    if (mime === "image/webp") return "webp"
    return "png"
  }

  async function persistStudioImage(input: {
    sessionID: string
    role: string
    dataUrl: string
  }) {
    const current = server.current
    if (!current) throw new Error("No active server.")
    const payload = studioImageDataUrlPayload(input.dataUrl)
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...directoryHeader(projectDir()),
    }
    if (current.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const response = await fetch(new URL("/artifact/upload", current.http.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: input.sessionID,
        filename: `${input.role}-${crypto.randomUUID()}.${studioImageExtension(payload.mime)}`,
        content: payload.content,
      }),
    })
    if (!response.ok) throw new Error(`Failed to persist Studio image: ${response.statusText}`)
    return response.json() as Promise<{ path: string }>
  }

  async function persistStudioGenerationMedia(input: {
    sessionID: string
    referenceImages: string[]
    sourceImage?: string
    extra?: Record<string, unknown>
  }) {
    const persisted = new Map<string, string>()
    const persist = async (value: string | undefined, role: string) => {
      if (!value?.startsWith("data:image/")) return value
      const existing = persisted.get(value)
      if (existing) return existing
      const uploaded = await persistStudioImage({
        sessionID: input.sessionID,
        role,
        dataUrl: value,
      })
      persisted.set(value, uploaded.path)
      return uploaded.path
    }
    const referenceImages = await Promise.all(
      input.referenceImages.map((item, index) => persist(item, `reference-${index + 1}`)),
    )
    const firstFrame = typeof input.extra?.firstFrame === "string"
      ? await persist(input.extra.firstFrame, "first-frame")
      : input.extra?.firstFrame
    const lastFrame = typeof input.extra?.lastFrame === "string"
      ? await persist(input.extra.lastFrame, "last-frame")
      : input.extra?.lastFrame
    const compositeImage = typeof input.extra?.compositeImage === "string"
      ? await persist(input.extra.compositeImage, "inpaint-composite")
      : input.extra?.compositeImage
    return {
      referenceImages: referenceImages.filter((item): item is string => Boolean(item)),
      sourceImage: await persist(input.sourceImage, "source"),
      extra: {
        ...(input.extra ?? {}),
        ...(typeof firstFrame === "string" ? { firstFrame } : {}),
        ...(typeof lastFrame === "string" ? { lastFrame } : {}),
        ...(typeof compositeImage === "string" ? { compositeImage } : {}),
      },
    }
  }

  async function getStudioGeneration(id: string, signal?: AbortSignal) {
    const current = server.current
    if (!current) throw new Error("No active server.")
    const headers: Record<string, string> = {
      ...directoryHeader(projectDir()),
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
    // 立即阻止轮询并更新 UI，让停止/发送按钮同步切换，不等 API 返回
    terminatedGenerationIDs.add(id)
    generationToken++
    const fallback = pendingResult()
    if (fallback?.id === id) {
      setPendingResult(undefined)
      setStatus("idle")
    }
    setCancellingGenerationIDs((ids) => new Set([...ids, id]))
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...directoryHeader(projectDir()),
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
      // API 成功 — UI 已在上面立即更新
      const sessionID = generation.sessionID ?? params.id
      if (sessionID) {
        void loadSessionMessages(sessionID).catch((error) => {
          console.error("[StudioPage] cancelled session load failed", error)
        })
      }
    } catch (error) {
      console.error("[StudioPage] cancel generation failed", error)
      // API 失败 — 回滚状态，允许轮询重新接管
      terminatedGenerationIDs.delete(id)
      if (fallback?.id === id) {
        setPendingResult(fallback)
        setStatus(fallback.status)
      }
    } finally {
      setCancellingGenerationIDs((ids) => new Set([...ids].filter((generationID) => generationID !== id)))
    }
  }

  async function rebootStudioGeneration(id: string) {
    if (rebootingGenerationIDs().has(id) || isActionBusy()) return
    const current = server.current
    if (!current) {
      showFloatingNotice("error", "重新生成失败：No active server.")
      return
    }
    setRebootingGenerationIDs((ids) => new Set([...ids, id]))
    setStudioWorkspaceOverlayOpen(false)
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...directoryHeader(projectDir()),
      }
      if (current.http.password) {
        headers.Authorization = `Basic ${authTokenFromCredentials({
          username: current.http.username,
          password: current.http.password,
        })}`
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), STUDIO_GENERATION_REBOOT_TIMEOUT_MS)
      const response = await fetch(
        new URL(`/studio/generations/${encodeURIComponent(id)}/reboot`, current.http.url),
        { method: "POST", headers, signal: controller.signal },
      ).finally(() => clearTimeout(timeout))
      const bodyText = await response.text()
      if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
      const generation = JSON.parse(bodyText) as StudioGenerationResult
      terminatedGenerationIDs.delete(id)
      setPendingResult((current) => ({
        ...generation,
        sessionID: current?.sessionID ?? generation.sessionID ?? params.id,
        displayPrompt: current?.id === generation.id ? current.displayPrompt ?? generation.displayPrompt : generation.displayPrompt,
        sourceImage: current?.id === generation.id ? current.sourceImage : undefined,
        inputImages: current?.id === generation.id ? current.inputImages : undefined,
        // Preserve custom size fields from current state — API response may not include them
        ...(current?.isCustom ? { isCustom: current.isCustom } : {}),
        ...(current?.width ? { width: current.width } : {}),
        ...(current?.height ? { height: current.height } : {}),
      }))
      setStatus(generation.status)
      const sessionID = generation.sessionID ?? params.id
      if (sessionID) {
        void loadSessionMessages(sessionID).catch((error) => {
          console.error("[StudioPage] rebooted session load failed", error)
        })
      }
    } catch (error) {
      showFloatingNotice("error", `重新生成失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRebootingGenerationIDs((ids) => new Set([...ids].filter((generationID) => generationID !== id)))
    }
  }

  function isStudioGenerationID(id: string) {
    return id.startsWith("studio_gen")
  }

  async function runGeneration(overrides?: StudioGenerationOverrides) {
    const nextCapability = overrides?.capability ?? capability()
    const nextStyleModel = overrides?.styleModel ?? styleModel()
    const nextAspectRatio = overrides?.aspectRatio ?? aspectRatio()
    const nextWidth = overrides?.width ?? customWidth()
    const nextHeight = overrides?.height ?? customHeight()
    const nextIsCustom = overrides ? Boolean(overrides.width && overrides.height) : isCustomStore() && nextWidth > 0 && nextHeight > 0
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
    const nextHasInvalidVideoFrames = nextCapability === "video.generate" && Boolean(nextVideoFrames.last && !nextVideoFrames.first)
    const nextHasVideoFrames = nextCapability === "video.generate" && Boolean(nextVideoFrames.first)
    const actualUserPrompt = (overrides?.prompt ?? prompt()).trim()
    const text = actualUserPrompt || (
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
    if (!text || isActionBusy() || nextHasInvalidVideoFrames) return
    const detailPrompt = overrides?.detailPrompt ?? (actualUserPrompt || (nextCapability === "video.generate" ? text : undefined))
    const detailTitle = overrides?.detailTitle ?? buildStudioDisplayPrompt(detailPrompt ?? text)
    const currentToken = ++generationToken
    const previousPrompt = prompt()
    const previousAssets = assets()
    const previousVideoFrames = { first: videoFrames.first, last: videoFrames.last }
    const videoReferenceImages = [
      nextVideoFrames.first,
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
    const generationExtra = {
      ...(overrides?.extra ?? {}),
      ...(studioContext ? { studioContext } : {}),
      ...(nextCapability === "video.generate"
        ? {
          videoMode: nextHasVideoFrames ? "first_last_frame" : "text",
          duration: nextVideoDuration,
          mode: nextVideoQualityMode,
          firstFrame: nextVideoFrames.first,
          lastFrame: nextVideoFrames.first ? nextVideoFrames.last : undefined,
        }
        : {}),
    }
    const pendingInputImages = buildStudioInputImages({
      capability: nextCapability,
      referenceImages,
      sourceImage: overrides?.sourceImage,
      extra: generationExtra,
    })
    setOpenMenu(null)
    setMode("preview")
    setSending(true)
    setStatus("submitting")
    setStudioWorkspaceOverlayOpen(false)
    if (!overrides?.useRestoredInputs && !fileManagerDetailView()) setSelectedResultId(undefined)
    if (fileManagerDetailView()) setFileManagerGenPending(true)
    setPendingResult({
      id: `studio_pending_${Date.now()}`,
      status: "running",
      capability: nextCapability,
      prompt: overrides?.effectivePrompt ?? overrides?.refinedPrompt ?? text,
      displayPrompt: overrides?.displayPrompt,
      detailPrompt,
      detailTitle,
      provider: "internel",
      model: nextStyleModel,
      styleModel: nextCapability === "image.generate" ? nextStyleModel : undefined,
      aspectRatio: nextIsCustom ? ("1:1" as StudioAspectRatio) : nextAspectRatio,
      width: nextIsCustom ? nextWidth : undefined,
      height: nextIsCustom ? nextHeight : undefined,
      isCustom: nextIsCustom || undefined,
      images: [],
      progress: 0,
      createdAt: Date.now(),
      sourceImage: overrides?.sourceImage,
      inputImages: pendingInputImages,
      ...(nextCapability === "video.generate"
        ? {
            videoMode: nextHasVideoFrames ? "first_last_frame" : "text",
            duration: nextVideoDuration,
            videoQualityMode: nextVideoQualityMode,
          }
        : {}),
    })
    // 发送瞬间强制滚动到底部，展示新发起的消息
    if (conversationScrollRef) {
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(() => {
        conversationScrollRef.scrollTo({ top: conversationScrollRef.scrollHeight })
      })
    }
    if (!overrides?.useRestoredInputs) {
      setPrompt("")
      setAssets([])
    }
    try {
      const existingSession = isValidStudioSession(params.id)
      const sessionID = existingSession ? params.id! : await createStudioSession(text)
      if (!sessionID) throw new Error("Unable to create Studio session.")
      if (currentToken !== generationToken) return
      // Always attach sessionID to pendingResult so it can be scoped to the correct session.
      setPendingResult((item) => item ? { ...item, sessionID } : item)
      if (!existingSession) {
        pendingGenerationSessionID = sessionID
        navigate(`/${routeSlug()}/studio/${sessionID}`)
      }
      createGenerationController?.abort()
      const controller = new AbortController()
      createGenerationController = controller
      const persistedMedia = await persistStudioGenerationMedia({
        sessionID,
        referenceImages,
        sourceImage: overrides?.sourceImage,
        extra: generationExtra,
      })
      if (currentToken !== generationToken) return
      setPendingResult((item) => item ? {
        ...item,
        sourceImage: persistedMedia.sourceImage ?? item.sourceImage,
        inputImages: buildStudioInputImages({
          capability: nextCapability,
          referenceImages: persistedMedia.referenceImages,
          sourceImage: persistedMedia.sourceImage,
          extra: persistedMedia.extra,
        }),
      } : item)
      const generation = await createStudioGeneration({
        sessionID,
        text,
        displayPrompt: overrides?.displayPrompt,
        detailPrompt,
        detailTitle,
        initialSessionTitle: existingSession ? undefined : buildStudioDisplayPrompt(text),
        shouldSetSessionTitle: existingSession ? undefined : true,
        capability: nextCapability,
        refinedPrompt: overrides?.refinedPrompt,
        effectivePrompt: overrides?.effectivePrompt,
        styleModel: nextStyleModel,
        aspectRatio: nextIsCustom ? undefined : nextAspectRatio,
        width: nextIsCustom ? nextWidth : undefined,
        height: nextIsCustom ? nextHeight : undefined,
        count: nextCount,
        referenceImages: persistedMedia.referenceImages,
        sourceImage: persistedMedia.sourceImage,
        extra: {
          ...persistedMedia.extra,
          ...(nextIsCustom ? { width: nextWidth, height: nextHeight } : {}),
        },
      }, controller.signal)
      if (!overrides?.useRestoredInputs && nextCapability === "video.generate") clearVideoFrames()
      if (currentToken !== generationToken) return
      setPendingResult((current) => ({
        ...generation,
        // Preserve sessionID from current — generation response may not include it
        sessionID: current?.sessionID ?? (generation as StudioGenerationResult).sessionID,
        displayPrompt: current?.displayPrompt ?? generation.displayPrompt,
        detailPrompt: current?.detailPrompt ?? generation.detailPrompt,
        detailTitle: generation.detailTitle ?? current?.detailTitle,
        styleModel: generation.styleModel ?? current?.styleModel,
        sourceImage: current?.sourceImage ?? overrides?.sourceImage,
        inputImages: current?.inputImages ?? pendingInputImages,
        // Preserve custom size fields from current state — API response may not include them
        ...(current?.isCustom ? { isCustom: current.isCustom } : {}),
        ...(current?.width ? { width: current.width } : {}),
        ...(current?.height ? { height: current.height } : {}),
      }))
      setStatus(generation.status)
      // Update thumbnail immediately if generation already succeeded (fast path,
      // e.g. mock/cached results — polling loop won't fire for non-queued status)
      if (generation.status === "succeeded" && sessionID) {
        void loadSessionMessages(sessionID).catch((error) => {
          console.error("[StudioPage] generated session load failed", error)
        })
        const images = generation.images
        if (images && images.length > 0) {
          console.log("[Thumbnail] Fast-path setThumbnail for session", sessionID, "images:", images.length)
          studioThumbnails.setThumbnail(sessionID, pickThumbnail(images)!)
        }
      }
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
      if (createGenerationController?.signal.aborted || currentToken === generationToken) createGenerationController = undefined
      if (currentToken === generationToken) setSending(false)
    }
  }

  // 文件管理详情页触发生成后：
  // - 成功：退出文件管理视图 + 创建 tab 并选中（与点击 studio-result-thumb 逻辑完全一致）
  // - 失败/取消：回到文件管理网格视图
  createEffect(() => {
    if (!fileManagerGenPending()) return
    if (!isBusy()) {
      setFileManagerGenPending(false)
      // pendingResult 可能已被 sync effect 清空，优先用它，其次查 displayTurns 最新项
      const pending = pendingResult()
      const latestTurn = displayTurns().at(-1)
      const successResult =
        (pending?.status === "succeeded" && pending.images.length > 0) ? pending
        : (latestTurn?.result?.status === "succeeded" && latestTurn.result.images.length > 0) ? latestTurn.result
        : null

      if (successResult) {
        batch(() => {
          setFileManagerDetailView(false)
          selectStudioImage({ resultID: successResult.id, imageID: successResult.images[0].id })
        })
      } else {
        // 失败或取消：回到文件管理网格
        backFromFileManagerDetail()
      }
    }
  })

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
            // 用户主动取消后不再更新 pendingResult，防止任务"重新出现"
            if (terminatedGenerationIDs.has(id)) {
              stopped = true
              return
            }
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
              return {
                ...generation,
                // Preserve sessionID from current when generation doesn't include it
                sessionID: current?.sessionID ?? (generation as StudioGenerationResult).sessionID,
                displayPrompt: current?.displayPrompt ?? generation.displayPrompt,
                detailPrompt: current?.detailPrompt ?? generation.detailPrompt,
                detailTitle: generation.detailTitle ?? current?.detailTitle,
                styleModel: generation.styleModel ?? current?.styleModel,
                sourceImage: current?.sourceImage,
                inputImages: current?.inputImages,
                // Preserve custom size fields from current state — API response may not include them
                ...(current?.isCustom ? { isCustom: current.isCustom } : {}),
                ...(current?.width ? { width: current.width } : {}),
                ...(current?.height ? { height: current.height } : {}),
              }
            })
            setStatus(generation.status)

            if (
              generation.status === "succeeded" ||
              generation.status === "create_failed" ||
              generation.status === "failed"
            ) {
              const sessionID = generation.sessionID ?? pendingResult()?.sessionID ?? params.id
              if (generation.status === "succeeded" && sessionID) {
                void loadSessionMessages(sessionID).catch((error) => {
                  console.error("[StudioPage] generated session load failed", error)
                })
                // Update session thumbnail when generation succeeds
                const images = generation.images
                if (images && images.length > 0) {
                  console.log("[Thumbnail] Polling setThumbnail for session", sessionID, "images:", images.length)
                  studioThumbnails.setThumbnail(sessionID, pickThumbnail(images)!)
                } else {
                  console.log("[Thumbnail] Polling succeeded but no images for session", sessionID, "generation.images:", generation.images)
                }
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

  function handleCancelGeneration() {
    const pollingId = pollingGenerationID()
    if (pollingId) {
      void cancelStudioGeneration(pollingId)
      return
    }
    // Still in submitting phase — abort via token
    createGenerationController?.abort()
    createGenerationController = undefined
    generationToken++
    setPendingResult(undefined)
    setStatus("idle")
    setSending(false)
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
    if (!canSubmit()) return
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
    if (!selectedImage() || isVideoMedia(selectedImage()) || isActionBusy()) return
    batch(() => {
      setCapability("image.upscale")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("hd")
    })
  }

  function openCutout() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isActionBusy()) return
    batch(() => {
      setCapability("image.cutout")
      setWorkspaceImage(undefined)
      setWorkspaceUploadRequested(false)
      setMode("cutout")
    })
  }

  function openInpaint() {
    if (!selectedImage() || isVideoMedia(selectedImage()) || isActionBusy()) return
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
    // 扩图结果比例：优先用画布框实际像素尺寸(realWidth/realHeight)推算，
    // 覆盖用户自由拖动（不匹配预设比例）的场景；否则回退 extra.ratio
    const extra = input.extra
    const realW = typeof extra?.realWidth === "number" ? extra.realWidth : undefined
    const realH = typeof extra?.realHeight === "number" ? extra.realHeight : undefined
    const ratioRaw = extra?.ratio
    const targetAspectRatio = realW && realH
      ? closestStudioAspectRatio(realW, realH)
      : typeof ratioRaw === "string" && (STUDIO_ASPECT_RATIOS as string[]).includes(ratioRaw)
        ? (ratioRaw as StudioAspectRatio)
        : undefined
    void runGeneration({
      capability: "image.outpaint",
      sourceImage: sourceUrl,
      aspectRatio: targetAspectRatio,
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
    if (isActionBusy()) return

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
      // 智能重绘保留源图比例，探测实际宽高以避免结果被默认为 3:4
      const sourceAspectRatio = await probeImageAspectRatio(sourceUrl)
      void runGeneration({
        capability: "image.inpaint",
        sourceImage: sourceUrl,
        aspectRatio: sourceAspectRatio,
        prompt: input.prompt || (input.hasDrawing
          ? input.mode === "erase" ? "消除涂抹区域内的物体" : "重绘所选区域"
          : input.mode === "erase" ? "消除图中的物体" : "重绘图片"),
        extra: {
          generateMode: input.mode,
          compositeImage: compositeData,
          hasDrawing: input.hasDrawing,
        },
      })
    }

    void doSubmit()
  }

  async function resizeCompositeImage(sourceDataUrl: string, targetDataUrl: string): Promise<string> {
    const [compositeImg, targetImg] = await Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Failed to load composite image"))
        img.src = sourceDataUrl
      }),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
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
    return canvas.toDataURL("image/png")
  }

  async function adjustImageForEdit(
    sourceUrl: string,
    opts: { maxSize: number; maxDimension: number; minSide: number },
  ): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = "anonymous"
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
    if (!image || isActionBusy()) return
    let sourceUrl = image.remoteUrl ?? image.url

    // Auto-adjust original image (not local upload) if exceeds limits
    if (!workspaceImage()) {
      sourceUrl = await adjustImageForEdit(sourceUrl, { maxSize: 20 * 1024 * 1024, maxDimension: 7500, minSide: 0 })
    }

    tracker.interaction({ module: "studio", name: "upscale", extend: JSON.stringify({ mode: input.mode, hasSourceImage: !!image, isUploadedImage: !!workspaceImage() }) })
    // 变清晰保留源图比例，探测实际宽高以避免结果被默认为 3:4
    const sourceAspectRatio = await probeImageAspectRatio(sourceUrl)
    void runGeneration({
      capability: "image.upscale",
      sourceImage: sourceUrl,
      aspectRatio: sourceAspectRatio,
      prompt: "将当前图片变清晰，提升分辨率和细节",
      extra: {
        mode: input.mode,
      },
    })
  }

  async function submitCutout() {
    const image = workspaceEditImage()
    if (!image || isActionBusy()) return
    let sourceUrl = image.remoteUrl ?? image.url

    // Auto-adjust original image (not local upload) if exceeds limits
    if (!workspaceImage()) {
      sourceUrl = await adjustImageForEdit(sourceUrl, { maxSize: 8 * 1024 * 1024, maxDimension: 7500, minSide: 50 })
    }

    tracker.interaction({ module: "studio", name: "cutout", extend: JSON.stringify({ hasSourceImage: !!image, isUploadedImage: !!workspaceImage() }) })
    // 抠图保留源图比例，探测实际宽高以避免结果被默认为 3:4
    const sourceAspectRatio = await probeImageAspectRatio(sourceUrl)
    void runGeneration({
      capability: "image.cutout",
      sourceImage: sourceUrl,
      aspectRatio: sourceAspectRatio,
      prompt: "对当前图片进行抠图，移除背景并保留主体",
    })
  }

  function regenerateCurrentResult() {
    const current = canvasResult() ?? result()
    if (!current) return
    if (resultRegenerateDisabled(current)) return
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

  const sessionDataLoaded = createMemo(() => {
    if (!params.id) return false
    return dataStore.message[params.id] !== undefined
  })

  const hasStudioConversation = createMemo(() => {
    // 切换 session 数据未加载时保持对话布局，避免闪现空状态
    if (params.id && !sessionDataLoaded()) return true
    return turns().length > 0 ||
      pendingEditorEntries().length > 0 ||
      Boolean(pendingResult()) ||
      sending() ||
      isEditingWorkspaceMode() ||
      Boolean(workspaceModeForCapability(capability()))
  })

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
    <div
      ref={studioPageRef!}
      class="studio-page"
      style={{ position: "relative" }}
      onPointerMove={onPagePointerMove}
      onPointerUp={onPagePointerUp}
    >
      <aside
        class="studio-left"
        classList={{ collapsed: studioLeftCollapsed() }}
        style={{
          width: studioLeftCollapsed() ? "68px" : `${studioLeftWidth()}px`,
          "flex-basis": studioLeftCollapsed() ? "68px" : `${studioLeftWidth()}px`,
          "min-width": studioLeftCollapsed() ? "68px" : undefined,
          transition: resizingLeft() ? "none" : "width 200ms ease, flex-basis 200ms ease",
        }}
      >
        <Show
          when={!studioLeftCollapsed()}
          fallback={
            <div
              class="h-full flex flex-col items-center"
              style={{
                background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
                padding: "12px 10px 24px 10px",
                cursor: "pointer",
              }}
              onClick={() => {
                if (isOverlayMode()) {
                  setStudioLeftOverlayOpen(true)
                } else {
                  toggleStudioLeft()
                }
              }}
            >
              <div class="flex flex-col items-center shrink-0" style={{ gap: "8px" }}>
                <button
                  type="button"
                  class="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(25,25,25,0.06)]"
                  style={{ width: "36px", height: "36px" }}
                  onClick={(e) => { e.stopPropagation(); startNewStudioConversation(); }}
                >
                  <Icon name="plus" size="normal" />
                </button>
                <div style={{ width: "48px", height: "1px", background: "rgba(0,0,0,0.1)" }} />
              </div>
              <img
                src="/studio/IconStudio1.svg"
                alt="Octo Studio"
                style={{ width: "20px", height: "20px", "margin-top": "16px", "flex-shrink": "0" }}
              />
              <div class="flex-1" />
              <button
                type="button"
                class="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(25,25,25,0.06)] shrink-0"
                style={{ width: "36px", height: "36px" }}
                onClick={(e) => { e.stopPropagation(); dialog.show(() => <DialogSettings />); }}
              >
                <Icon name="settings-gear" size="small" />
              </button>
            </div>
          }
        >
          <StudioHistory
            directory={projectDir()}
            routeSlug={routeSlug()}
            activeSessionID={params.id}
            onNewConversation={startNewStudioConversation}
            toggleDrawer={showToggleDrawer() ? toggleStudioLeft : undefined}
            thumbnails={studioThumbnails.thumbnails}
            thumbnailsLoading={studioThumbnails.loading()}
            thumbnailVersion={studioThumbnails.version()}
            onLoadThumbnails={(sessions) => studioThumbnails.loadThumbnails(sessions)}
          />
        </Show>
      </aside>
      <div
        class="absolute top-0 bottom-0 cursor-col-resize z-10"
        classList={{ hidden: studioLeftCollapsed() }}
        style={{ left: `${studioLeftWidth()}px`, width: "8px" }}
        onPointerDown={handleStudioLeftResize}
      />

      <Show when={hasStudioConversation()} fallback={
        <main class="studio-empty-workspace">
          <div class="studio-empty-stack">
            <div class="studio-empty-group">
              <StudioIntro />
              <div class="relative size-full">

                <StudioComposer
                  prompt={prompt()}
                  capability={capability()}
                  canGenerateVideo={canGenerateVideo()}
                  canUseSeedream={canUseSeedream()}
                  styleModel={styleModel()}
                  maxReferenceImages={maxReferenceImages()}
                  aspectRatio={aspectRatio()}
                  count={count()}
                  customWidth={customWidth()}
                  customHeight={customHeight()}
                  isCustom={isCustomStore()}
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
                  onStyleModel={selectStyleModel}
                  onAspectRatio={setAspectRatio}
                  onCount={setCount}
                  onCustomWidth={setCustomWidth}
                  onCustomHeight={setCustomHeight}
                  onIsCustom={setIsCustomStore}
                  onVideoDuration={setVideoDuration}
                  onVideoQualityMode={setVideoQualityMode}
                  onOpenMenu={setOpenMenu}
                  onCancel={handleCancelGeneration}
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
                  onReversePrompt={() => void handleReversePrompt()}
                />
            </div>
          </div>
        </div>
        </main>
      }>
          <section class="studio-center" style={studioCenterStyle()}>
          <div class="studio-center-header">
            <div class="flex-1 min-w-0">
            <Show
              when={headerTitle.editing}
              fallback={
                <>
                  <div
                    ref={(el) => { headerSpanRef = el; headerResizeObserver?.disconnect(); headerResizeObserver = new ResizeObserver(() => checkHeaderTruncation()); headerResizeObserver.observe(el); queueMicrotask(() => checkHeaderTruncation()) }}
                    class="studio-center-title"
                    onMouseEnter={enterHeaderTrigger}
                    onMouseLeave={leaveHeaderTrigger}
                  >{currentTitle()}</div>
                  <Show when={showHeaderTooltip()}>
                    <Portal>
                      <div
                        ref={headerTooltipRef!}
                        style={headerTooltipStyle()}
                        onMouseEnter={enterHeaderTooltip}
                        onMouseLeave={leaveHeaderTooltip}
                        class="studio-custom-tooltip fixed z-[1000]"
                      >
                        {currentTitle()}
                      </div>
                    </Portal>
                  </Show>
                </>
              }
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
            </div>
            <div class="flex items-center gap-1 relative" style={{ "z-index": "60" }}>
              <Show when={params.id && (showStudioWorkspace() || !studioWorkspaceOverlayOpen())}>
                <DropdownMenu
                  gutter={4}
                  placement="bottom-end"
                  open={headerTitle.menuOpen}
                  onOpenChange={(open) => setHeaderTitle("menuOpen", open)}
                >
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="ellipsis"
                    variant="ghost"
                    class="studio-center-action size-7 rounded-md data-[expanded]:bg-surface-base-active" style={{"z-index": "150", position: "relative"}}
                    aria-label={language.t("common.moreOptions")}
                    aria-expanded={headerTitle.menuOpen}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      style={{ "min-width": "104px", "z-index": "1000" }}
                      onCloseAutoFocus={(event) => {
if (!headerTitle.pendingRename) return
                        event.preventDefault()
                        setHeaderTitle("pendingRename", false)
                        openHeaderTitleEditor()
                      }}
                    >
                      <DropdownMenu.Item
                        onSelect={() => {
                          setHeaderTitle({ pendingRename: true, menuOpen: false })
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        onSelect={() => {
                          const session = activeStudioSession() ?? { id: params.id!, title: currentTitle(), agent: "octo_studio" } as Session
                          dialog.show(() => <DialogDeleteHeaderSession session={session} />)
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
            </Show>
            <Show when={!showStudioWorkspace()}>
              <button
                type="button"
                class="flex items-center justify-center rounded-md transition-colors hover:bg-[rgba(25,25,25,0.06)] shrink-0"
                style={{ width: "20px", height: "20px" }}
                onClick={(e) => { e.stopPropagation(); setStudioWorkspaceOverlayOpen((v) => !v); }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="15" viewBox="0 0 12 15" fill="none" class="shrink-0">
                  <rect x="0.5" y="0.5" width="11" height="14" rx="2" stroke="#000000" />
                  <line x1="2.67" y1="0.5" x2="2.67" y2="14.5" stroke="#000000" />
                </svg>
              </button>
            </Show>
            </div>
          </div>

          <ScrollView
            viewportRef={(el) => {
              conversationScrollRef = el
              requestAnimationFrame(() => {
                el.scrollTo({ top: el.scrollHeight })
              })
            }}
            onScroll={handleConversationScroll}
            class="studio-center-scroll"
          >
            <Show when={displayTurns().length > 0 || pendingResult() || sending() || isBusy()} fallback={params.id && !sessionDataLoaded() && !visitedSessionIds.has(params.id) ? null : <StudioIntro />}>
              <StudioConversation
                result={result()}
                turns={displayTurns()}
                sdkUrl={globalSDK.url}
                directory={projectDir()}
                busy={effectiveStatus() === "queued" || effectiveStatus() === "running" || effectiveStatus() === "submitting"}
                actionBusy={isActionBusy()}
                cancellingGenerationIDs={cancellingGenerationIDs()}
                rebootingGenerationIDs={rebootingGenerationIDs()}
                onCancelGeneration={(generationID) => void cancelStudioGeneration(generationID)}
                onEditGeneration={(generation) => void editGenerationDraft(generation)}
                onRebootGeneration={(generationID) => void rebootStudioGeneration(generationID)}
                onSelectImage={selectStudioImage}
                onOpenEditor={openEditorEntry}
                onUseInputImage={useConversationInputImage}
              />
            </Show>
          </ScrollView>

          <StudioComposer
            prompt={prompt()}
            capability={capability()}
            canGenerateVideo={canGenerateVideo()}
            canUseSeedream={canUseSeedream()}
            styleModel={styleModel()}
            maxReferenceImages={maxReferenceImages()}
            aspectRatio={aspectRatio()}
            count={count()}
            customWidth={customWidth()}
            customHeight={customHeight()}
            isCustom={isCustomStore()}
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
            onStyleModel={selectStyleModel}
            onAspectRatio={setAspectRatio}
            onCount={setCount}
            onCustomWidth={setCustomWidth}
            onCustomHeight={setCustomHeight}
            onIsCustom={setIsCustomStore}
            onVideoDuration={setVideoDuration}
            onVideoQualityMode={setVideoQualityMode}
            onOpenMenu={setOpenMenu}
            onCancel={handleCancelGeneration}
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
            onToolClick={() => { if (!showStudioWorkspace()) setStudioWorkspaceOverlayOpen(true) }}
            onReversePrompt={() => void handleReversePrompt()}
          />
        </section>
        <div
          class="absolute top-0 bottom-0 cursor-col-resize z-10"
          classList={{ hidden: !showStudioWorkspace() }}
          style={{ left: `${centerResizeLeft() + studioCenterWidth()}px`, width: "8px" }}
          onPointerDown={handleStudioCenterResize}
        />

      <Show when={!showStudioWorkspace() && studioWorkspaceOverlayOpen()}>
        <div
          class="absolute inset-0"
          style={{ "z-index": "39" }}
          onClick={(e) => {
            const hit = document.elementsFromPoint(e.clientX, e.clientY)
              .find(el => (el as HTMLElement).closest(".studio-assistant-editor-link"))
            if (hit) {
              const btn = (hit as HTMLElement).closest(".studio-assistant-editor-link") as HTMLElement | null
              btn?.click()
              return
            }
            setStudioWorkspaceOverlayOpen(false)
          }}
        />
      </Show>
      <Show when={showStudioWorkspace() || studioWorkspaceOverlayOpen()}>
      <main
        class="studio-workspace"
        classList={{ "studio-workspace-overlay": !showStudioWorkspace() && studioWorkspaceOverlayOpen() }}
      >
        <Show when={isEditingWorkspaceMode() || showStudioCanvas() || isBusy()} fallback={
          params.id && !sessionDataLoaded() && !visitedSessionIds.has(params.id) ? null : (
            <div class="studio-empty-workspace">
              <StudioIntro />
            </div>
          )
        }>
        <section ref={setStudioCanvasEl} class="studio-canvas">
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
                  // fallback 模式（无 tabs）：切换到文件管理
                  setShowFileManager(true)
                  setFileManagerDetailView(false)
                  setStudioViewPref("mode", "file-manager")
                  const allIds = result()?.images.map((img) => img.id) ?? []
                  setDeletedImageIds(new Set(allIds))
                  setSelectedImageId(undefined)
                  setSelectedResultId(undefined)
                })
              }}
              onCloseTab={closeCanvasTab}
              onUpscale={openHD}
              onCutout={openCutout}
              onInpaint={openInpaint}
              onOutpaint={openOutpaint}
              onRegenerate={regenerateCurrentResult}
              onGenerateVideo={generateVideoFromSelectedImage}
              showVideoGeneration={canGenerateVideo()}
              regenerateDisabled={resultRegenerateDisabled(result())}
              actionDisabled={isActionBusy()}
              showFileManagerTab={true}
              onFileManagerClick={() => {
                if (fileManagerDetailView()) {
                  if (showFileManager()) {
                    // 当前在详情页 → 返回网格视图
                    backFromFileManagerDetail()
                  } else {
                    // 从 canvas 切回来 → 恢复之前的详情视图及选中项
                    if (fileManagerDetailResultId && fileManagerDetailImageId) {
                      setSelectedResultId(fileManagerDetailResultId)
                      setSelectedImageId(fileManagerDetailImageId)
                    }
                    setShowFileManager(true)
                    setStudioViewPref("mode", "file-manager")
                  }
                } else if (canvasTabImages().length === 0) {
                  // 无图片 tab，保持在文件管理，不切换
                } else {
                  setShowFileManager((v) => {
                    const next = !v
                    setStudioViewPref("mode", next ? "file-manager" : "canvas")
                    return next
                  })
                }
              }}
              showFileManager={showFileManager()}
              fileManagerDetailView={fileManagerDetailView()}
              onFileManagerBack={backFromFileManagerDetail}
              onFileManagerSelectMedia={(item: { id: string; turnID: string }) => {
                const turn = displayTurns().find((t) => t.result?.id === item.turnID || t.id === item.turnID)
                if (turn?.result) {
                  selectFileManagerMedia({ resultID: turn.result.id, imageID: item.id })
                }
              }}
              studioCenterWidth={studioCenterWidth()}
              showStudioCenter={true}
              hideFileManagerFilter={studioLeftOverlayOpen() || fileManagerDetailView()}
              turns={displayTurns()}
              canGenerateVideo={canGenerateVideo()}
              sessionID={params.id}
              fileManagerGenPending={fileManagerGenPending()}
            >
              <Show when={showStudioCanvas() && canvasResult()?.images.length && (canvasWidth() >= 700 || studioCanvasWidth() >= 700)}>
                <div class="studio-details-wrapper" classList={{ expanded: showStudioDetails() }}>
                  <button
                    class="studio-details-toggle"
                    onClick={() => setShowStudioDetails((v) => !v)}
                    aria-label={showStudioDetails() ? "收起详情" : "展开详情"}
                  />
                  <Show when={showStudioDetails()}>
                    <aside class="studio-details">
                      <StudioDetails
                        result={result()!}
                        image={selectedImage()}
                        selectedImageId={selectedImageId()}
                        imageLabel={currentImageLabel()}
                        regenerateDisabled={resultRegenerateDisabled(result())}
                        showVideoGeneration={canGenerateVideo()}
                        onSelectImage={(id) => {
                          const r = result()
                          batch(() => {
                            setShowStudioCanvas(true)
                            setShowFileManager(false)
                            setStudioViewPref("mode", "canvas")
                            if (r && canvasTabImages().some((tabImg) => r.images.some((img) => img.id === tabImg.id))) {
                              // 已有 tab → 只切选中
                              setSelectedImageId(id)
                              const imageIndex = r.images.findIndex((img) => img.id === id)
                              const tabImg = canvasTabImages().find((tabImg) => r.images.some((img) => img.id === tabImg.id))
                              if (tabImg && imageIndex !== -1) {
                                setCanvasTabLabels((prev) => ({
                                  ...prev,
                                  [tabImg.id]: canvasTabLabel(r, imageIndex),
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
                              setCanvasTabLabels((prev) => ({ ...prev, [first.id]: canvasTabLabel(r, imageIndex) }))
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
                </div>
              </Show>
            </StudioResultCanvas>
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
                  busy={isActionBusy()}
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
                  busy={isActionBusy()}
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
        </main>
        </Show>
      </Show>
      <input ref={fileInputRef!} type="file" accept=".png,.jpg,.jpeg,.webp" multiple class="hidden" onChange={handleFileChange} />
      <input ref={videoFrameInputRef!} type="file" accept="image/png,image/jpeg" class="hidden" onChange={handleVideoFrameFileChange} />
      <Show when={videoRiskDialogOpen()}>
        <StudioVideoRiskDialog onCancel={cancelVideoRiskDialog} onConfirm={confirmVideoRiskDialog} />
      </Show>
      <Show when={isOverlayMode() && studioLeftOverlayOpen()}>
        <div
          style={{
            position: "absolute",
            inset: "0",
            "z-index": "100",
          }}
          onClick={() => setStudioLeftOverlayOpen(false)}
        />
        <aside
          style={{
            position: "absolute",
            top: "0",
            left: "0",
            bottom: "0",
            width: "296px",
            "z-index": "101",
            background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
            "border-right": "1px solid var(--border-weak-base)",
            "box-shadow": "4px 0 24px rgba(0, 0, 0, 0.12)",
            overflow: "hidden",
          }}
        >
          <StudioHistory
            directory={projectDir()}
            routeSlug={routeSlug()}
            activeSessionID={params.id}
            onNewConversation={() => {
              setStudioLeftOverlayOpen(false)
              startNewStudioConversation()
            }}
            thumbnails={studioThumbnails.thumbnails}
            thumbnailsLoading={studioThumbnails.loading()}
            thumbnailVersion={studioThumbnails.version()}
            onLoadThumbnails={(sessions) => studioThumbnails.loadThumbnails(sessions)}
          />
        </aside>
      </Show>
    </div>
  )
}
