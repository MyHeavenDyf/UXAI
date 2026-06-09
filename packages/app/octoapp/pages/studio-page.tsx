import "./studio/studio.css"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from "solid-js"
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
  capabilityLabel,
  styleModelLabel,
} from "./studio/data"
import type {
  StudioAsset,
  StudioAspectRatio,
  StudioCapability,
  StudioGenerationResult,
  StudioGenerationStatus,
  StudioImage,
  StudioMode,
} from "./studio/types"
import {
  buildStudioDisplayPrompt,
  buildStudioTurns,
  type StudioTurnData,
} from "./studio/turns"
import { StudioHistory } from "./studio/studio-history"
import { StudioComposer, StudioIntro } from "./studio/studio-composer"
import { StudioConversation, StudioDetails, StudioResultCanvas, StudioWorkspaceUpload } from "./studio/studio-conversation"
import { StudioCutoutEditor, StudioHDEditor } from "./studio/studio-editors-basic"
import { StudioInpaintEditor } from "./studio/studio-inpaint-editor"
import { StudioOutpaintEditor } from "./studio/studio-outpaint-editor"
import type { MaterialWordBook } from "./studio/MaterialMenu"
import {
  createBlobUrlFromDataUrl,
  formatStudioGenerationError,
  hasVideoFrameAssets,
  isVideoMedia,
  STUDIO_GENERATION_CREATE_TIMEOUT_MS,
  STUDIO_GENERATION_STATUS_INTERVAL_MS,
  STUDIO_VIDEO_ASPECT_RATIOS,
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
  const [openMenu, setOpenMenu] = createSignal<"capability" | "style" | "settings" | "material" | null>(null)
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
    if (result()?.status === "queued") return "queued"
    if (result()?.status === "running") return "running"
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
    if (studioTurn()?.result?.status === "queued" || studioTurn()?.result?.status === "running") {
      const next = studioTurn()!.result!
      setPendingResult((current) => {
        if (!current || current.status === next.status && current.progress === next.progress && current.order === next.order) return current
        return { ...current, ...next, sourceImage: current.sourceImage }
      })
      setStatus(next.status)
      return
    }
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
    if (studioTurn()?.result?.status === "queued" || studioTurn()?.result?.status === "running") {
      const next = studioTurn()!.result!
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
        const preserveGenerationCapability = Boolean(id && id === pendingGenerationSessionID)
        if (preserveEditorEntry) pendingEditorSessionID = undefined
        if (preserveGenerationCapability) pendingGenerationSessionID = undefined
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
          if (!preserveGenerationCapability) setCapability("image.generate")
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
          ? "好的，我将根据涂抹区域局部重绘当前图片。"
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
    const timeout = setTimeout(() => controller.abort(), STUDIO_GENERATION_CREATE_TIMEOUT_MS)
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

  async function getStudioGeneration(id: string) {
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
    const response = await fetch(new URL(`/studio/generations/${encodeURIComponent(id)}`, current.http.url), { headers })
    const bodyText = await response.text()
    if (!response.ok) throw new Error(formatStudioGenerationError(response, bodyText))
    return JSON.parse(bodyText) as StudioGenerationResult
  }

  function isStudioGenerationID(id: string) {
    return id.startsWith("studio_gen")
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
      progress: 0,
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
      if (!existingSession) {
        pendingGenerationSessionID = sessionID
        navigate(`/${slug()}/studio/${sessionID}`)
      }
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
      setStatus(generation.status)
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

  createEffect(() => {
    const active = pendingResult() ?? studioTurn()?.result
    if (!active || active.status !== "queued" && active.status !== "running") return
    if (active.id.startsWith("studio_pending_")) return
    if (!isStudioGenerationID(active.id)) return
    const id = active.id
    const refresh = () => {
      getStudioGeneration(id)
        .then((generation) => {
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
          const sessionID = generation.sessionID ?? params.id
          if (generation.status === "succeeded" && sessionID) return loadSessionMessages(sessionID)
        })
        .catch((error) => {
          console.error("[StudioPage] generation status load failed", error)
          const message = error instanceof Error ? error.message : String(error)
          const current = pendingResult()
          if (current && current.id !== id) return
          setStatus("failed")
          setPendingResult({
            ...(current ?? active),
            status: "failed",
            error: message,
          })
        })
    }
    void refresh()
    const timer = setInterval(refresh, STUDIO_GENERATION_STATUS_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

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
                busy={effectiveStatus() === "queued" || effectiveStatus() === "running" || effectiveStatus() === "submitting"}
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
