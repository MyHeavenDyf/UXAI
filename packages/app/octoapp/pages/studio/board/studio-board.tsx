import { Graph, Point, Shape, type Edge, type Node } from "@antv/x6"
import { batch, createEffect, createMemo, getOwner, onCleanup, onMount, runWithOwner, Show } from "solid-js"
import { createStore, reconcile as reconcileStore } from "solid-js/store"
import { render } from "solid-js/web"
import {
  type BoardSettings,
  type BoardReference,
  BoardSnapshot,
  BOARD_MIN_ZOOM,
  BOARD_MAX_ZOOM,
  BOARD_UPSCALE_PROMPT,
  BOARD_CUTOUT_PROMPT,
  boardImageOperationName,
  boardFrameSourceCount,
  boardGenerationError,
  boardReferenceActive,
  boardEdgeRole,
  BOARD_VIDEO_REFERENCE_LIMIT,
  recoverBoardDraft,
  type BoardSubmission,
} from "@opencode-ai/core/studio-board"
import { studioPermissionState } from "../studio-permission-store"
import { defaultStudioStyleModel, studioModelUnavailableMessage } from "@opencode-ai/core/studio/model-availability"
import { createBoardOperations } from "./studio-board-operations"
import { isSeedreamStyleModel, referenceImageLimit, styleModelId } from "../data"
import { originalMediaSrc, resolveStudioMediaUrl } from "../studio-media"
import { prepareStudioMediaDownload, saveStudioMediaDownload, type StudioHDMode, type StudioInpaintMode } from "../studio-shared"
import { prepareStudioImageOperation, prepareStudioOutpaintImage, resizeStudioCompositeImage } from "../studio-edit-image"
import { STUDIO_OUTPAINT_PROMPT } from "@opencode-ai/core/studio-outpaint"
import { createStudioOutpaint, type StudioOutpaintInput } from "../studio-outpaint-stage"
import { createStudioInpaintDrawing, studioInpaintPrompt, type StudioInpaintInput } from "../studio-inpaint-canvas"
import { tracker } from "@/utils/tracker"
import type { StudioGenerationResult, StudioImage } from "../types"
import { StudioFullscreenImage } from "../studio-fullscreen-image"
import { StudioVideoPlayer } from "../studio-video-player"
import {
  boardResponse,
  boardBackup,
  readBoardBackup,
  createBoardRequest,
  BoardRequestError,
  boardErrorMessage,
  type BoardGenerationRequest,
} from "./studio-board-api"
import {
  boardBusy,
  boardFailed,
  boardRebootable,
  boardMedia,
  boardCover,
  boardDisplayedMedia,
  boardReferences,
  boardConnectionError,
  boardWheelZoom,
  boardDocumentJSON,
  boardDocumentSnapshot,
  boardNextCardPosition,
  boardCanGenerate,
  normalizeBoardSettings,
  normalizeBoardDraft,
  emptyBoard,
  newBoardCard,
  type BoardCard,
  type BoardResults,
} from "./studio-board-state"
import { StudioBoardCardView } from "./studio-board-card"
import { StudioBoardMediaToolbar } from "./studio-board-media-toolbar"
import { StudioBoardVideo } from "./studio-board-video"
import { StudioBoardComposer } from "./studio-board-composer"
import { StudioBoardUpscale } from "./studio-board-upscale"
import { StudioBoardInpaint } from "./studio-board-inpaint"
import { StudioBoardOutpaint } from "./studio-board-outpaint"
import { StudioBoardResults } from "./studio-board-results"
import { StudioBoardHeader, type BoardSessionPage } from "./studio-board-header"
import { StudioBoardTools } from "./studio-board-tools"
import type { ThumbnailMap } from "../session-thumbnail"
import "./studio-board.css"

const WIDTH = 304
const HEIGHT = 330
const hosts = new Map<string, HTMLElement>()
const edgeStyle = {
  zIndex: 0,
  router: { name: "normal" },
  connector: { name: "smooth" },
  attrs: {
    line: { stroke: "#a7abc4", strokeWidth: 2, sourceMarker: null, targetMarker: null },
    wrap: { strokeWidth: 18 },
  },
}
Graph.registerConnectionPoint(
  "studio-board-card-border",
  (line, view, _magnet, _options, type) => {
    const box = view.cell.getBBox()
    // The media starts below the title, with a two-pixel inset from the node bounds.
    const radius = Math.min(12, (box.height - 30) / 2)
    return new Point(
      type === "source" ? box.right - 2 : box.left + 2,
      Math.max(box.top + 28 + radius, Math.min(box.bottom - 2 - radius, line.end.y)),
    )
  },
  true,
)
function cardTerminal(cell: string, port: string) {
  return { cell, port, connectionPoint: { name: "studio-board-card-border" } }
}
Shape.HTML.register({
  shape: "studio-board-card",
  width: WIDTH,
  height: HEIGHT,
  effect: [],
  html: (cell) => hosts.get(cell.id) ?? document.createElement("div"),
})

export default function StudioBoard(props: {
  directory: string
  http: { url: string; username?: string; password?: string }
  sessionID?: string
  userIdx?: string
  demo?: boolean
  title?: string
  thumbnails?: ThumbnailMap
  loadSessions?: (cursor?: string) => Promise<BoardSessionPage>
  loadThumbnails?: (sessions: BoardSessionPage["sessions"]) => void
  onRenameSession?: (id: string, title: string) => Promise<void>
  onSelectSession?: (id?: string) => void | Promise<void>
  onThumbnail?: (id: string, result: StudioGenerationResult) => void
  createSession: (creationID: string) => Promise<string | undefined>
  onSessionCreated: (id: string) => void
  onExit: () => void
  onBusy?: (sessionID: string, busy: boolean) => void
  onRetryPermission: () => void
}) {
  const owner = getOwner()
  const scope = { http: { ...props.http }, directory: props.directory }
  const [state, setState] = createStore({
    document: emptyBoard(),
    results: {} as BoardResults,
    selectedIDs: [] as string[],
    sessionID: props.sessionID,
    creationID: String(crypto.randomUUID()),
    recovery: "",
    savedDocumentJSON: boardDocumentJSON(emptyBoard()),
    revision: 0,
    ready: !!props.demo,
    initializing: false,
    loading: false,
    saving: false,
    exiting: false,
    saveError: "",
    error: "",
    notice: "",
    resultsCardID: "",
    inspectGenerationID: "",
    fullscreenMedia: undefined as StudioImage | undefined,
    menuTab: "",
    zoom: 1,
    tool: "select" as "select" | "pan",
    toolMenu: false,
    temporaryPan: false,
    menu: undefined as
      | { x: number; y: number; point: { x: number; y: number }; sourceID?: string; previewID?: string }
      | undefined,
    anchor: { left: 0, top: 0, width: 544 },
    mediaToolbarAnchor: { left: 0, top: 0 },
    video: undefined as { cardID: string; source: BoardReference } | undefined,
    upscaleCardID: "",
    cutoutCardID: "",
    inpaint: undefined as { cardID: string; generationID: string; mediaID: string; image: string; url: string } | undefined,
    inpaintMode: "qwen_image_edit" as StudioInpaintMode,
    inpaintBrush: 40,
    inpaintPrompt: "",
    inpaintError: "",
    inpaintAnchor: { left: 0, top: 0, width: 488 },
    outpaint: undefined as { cardID: string; generationID: string; mediaID: string; url: string } | undefined,
    outpaintPrompt: "",
    outpaintError: "",
    outpaintAnchor: { left: 0, top: 0, width: 440 },
    upscaleMode: "restoration_8k" as StudioHDMode,
    derivedPreparing: false,
    submissionErrors: {} as Record<string, string>,
    marquee: undefined as { x: number; y: number; width: number; height: number } | undefined,
    historyCoverIDs: [] as string[],
    suppressedFailureIDs: [] as string[],
    guides: {} as { x?: number; y?: number },
    draggingCard: false,
  })
  const documentJSON = createMemo(() => boardDocumentJSON(state.document))
  const panning = () => state.tool === "pan" || state.temporaryPan
  const dirty = () => documentJSON() !== state.savedDocumentJSON
  const operations = createBoardOperations()
  const roots = new Map<string, () => void>()
  const cardSizes = new Map<string, { width: number; height: number }>()
  const tokens = new Map<string, number>()
  const reboots = new Map<string, string>()
  const pending = new Map<string, BoardGenerationRequest>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const selected = createMemo(() =>
    state.selectedIDs.length === 1 ? state.document.cards.find((card) => card.id === state.selectedIDs[0]) : undefined,
  )
  const references = createMemo(() =>
    selected() ? boardReferences(state.document, selected()!.id, state.results) : [],
  )
  const showMentionEntry = () =>
    selected()?.kind === "image" && isSeedreamStyleModel(selected()!.draft.settings.styleModel)
  const busy = () =>
    state.derivedPreparing ||
    operations.busy() ||
    state.document.cards.some((card) => card.taskLinks.some((link) => boardBusy(state.results[link.generationID])))
  const awaitingRecovery = () =>
    state.initializing || state.loading || !state.ready || !!state.error || !!state.recovery
  const request = createBoardRequest(scope.http, scope.directory)
  const mediaURL = (value?: string) =>
    value?.startsWith("/studio/board-demo/")
      ? value
      : resolveStudioMediaUrl({ value, sdkUrl: scope.http.url, directory: scope.directory })
  const backupKey = (id = state.sessionID) => `studio.board.backup:${scope.http.url}:${scope.directory}:${id ?? "new"}`
  const current = (card: BoardCard) => state.results[card.currentGenerationID ?? ""]
  const locked = (card: BoardCard) => !!operations.state[card.id] || boardBusy(current(card))
  const editingBlocked = (card: BoardCard) => state.exiting || awaitingRecovery() || locked(card) || state.derivedPreparing
  const inpaintDrawing = createStudioInpaintDrawing({
    source: () => state.inpaint?.url,
    key: () => state.inpaint && `${state.inpaint.generationID}:${state.inpaint.mediaID}`,
    brushSize: () => state.inpaintBrush,
    busy: () => busy() || awaitingRecovery(),
  })
  createEffect(() => {
    const edit = state.video
    if (!edit) return
    const card = selected()
    const media = card && boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
    if (card?.id !== edit.cardID || media?.generationID !== edit.source.generationID || media?.mediaID !== edit.source.mediaID)
      setState("video", undefined)
  })
  const outpaintEditor = createStudioOutpaint({
    source: () => state.outpaint?.url,
    key: () => state.outpaint && `${state.outpaint.generationID}:${state.outpaint.mediaID}`,
    busy: () => busy() || awaitingRecovery() || !!state.saveError,
    stage: { width: 768, height: 768 },
  })
  createEffect(() => {
    const edit = state.outpaint
    if (!edit) return
    const card = selected()
    const media = card && boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
    if (card?.id !== edit.cardID || media?.generationID !== edit.generationID || media?.mediaID !== edit.mediaID)
      setState("outpaint", undefined)
  })
  createEffect(() => {
    const edit = state.inpaint
    if (!edit) return
    const card = selected()
    const media = card && boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
    if (card?.id !== edit.cardID || media?.generationID !== edit.generationID || media?.mediaID !== edit.mediaID)
      setState("inpaint", undefined)
  })
  let board!: HTMLDivElement
  let canvas!: HTMLDivElement
  let uploadInput: HTMLInputElement | undefined
  let uploadRole: "reference" | "firstFrame" | "lastFrame" = "reference"
  let uploadCardID: string | undefined
  let composer: HTMLDivElement | undefined
  let dropdown: HTMLDivElement | undefined
  const menuButtons = new Map<string, HTMLDivElement>()
  let graph: Graph | undefined
  let disposed = false
  let frame = 0
  let wheelFrame = 0
  let wheelDelta = 0
  let wheelPoint = { x: 0, y: 0 }
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let saveChain = Promise.resolve()
  let initialBackup: ReturnType<typeof boardBackup.parse> | undefined
  let creating: Promise<string | undefined> | undefined
  let titleChange: Promise<void> | undefined
  let stopFlow = () => {}
  let temporaryEdge: Edge | undefined
  let selectionStart: { x: number; y: number; selectedIDs: string[] } | undefined
  let snapping = false
  let outpaintPositionID = ""
  createEffect(() => {
    const edit = state.outpaint
    if (outpaintPositionID && outpaintPositionID !== edit?.cardID) {
      const card = state.document.cards.find((card) => card.id === outpaintPositionID)
      const node = graph?.getCellById(outpaintPositionID)
      if (card && node?.isNode()) node.position(card.position.x, card.position.y)
      outpaintPositionID = ""
      updateAnchor()
    }
    if (!edit || !outpaintEditor.state.ready) return
    const card = state.document.cards.find((card) => card.id === edit.cardID)
    const node = graph?.getCellById(edit.cardID)
    if (!card || !node?.isNode()) return
    outpaintPositionID = card.id
    node.position(card.position.x + outpaintEditor.rect().x - outpaintEditor.image().x,
      card.position.y + outpaintEditor.rect().y - outpaintEditor.image().y)
    updateAnchor()
  })

  function notify(message: string) {
    clearTimeout(noticeTimer)
    setState("notice", message)
    noticeTimer = setTimeout(() => setState("notice", ""), 3500)
  }
  async function downloadMedia(card: BoardCard) {
    const media = boardDisplayedMedia(card, state.results)
    if (!media) return
    const source = mediaURL(originalMediaSrc(media))
    if (!source) return
    const prepared = await prepareStudioMediaDownload({
      source,
      fallbackMime: card.kind === "video" ? "video/mp4" : "image/png",
    })
    tracker.interaction({
      module: "studio",
      name: "download",
      extend: JSON.stringify({ name: prepared.label, url: source }),
    })
    const result = await saveStudioMediaDownload({ source, ...prepared })
    if (disposed) return
    if (result.saved) notify("下载成功")
    if (result.fallback) notify("部分文件无法保存，已转交浏览器下载，请注意浏览器下载列表")
  }
  function toggleUpscale() {
    const card = selected()
    if (!card || card.kind !== "image" || editingBlocked(card) || !boardDisplayedMedia(card, state.results)) return
    setState("menuTab", "")
    setState("inpaint", undefined)
    setState("outpaint", undefined)
    setState("video", undefined)
    setState("upscaleCardID", state.upscaleCardID === card.id ? "" : card.id)
    setState("upscaleMode", "restoration_8k")
    updateAnchor()
  }
  function toggleInpaint() {
    const card = selected()
    if (!card || card.kind !== "image" || busy() || editingBlocked(card)) return
    if (state.inpaint?.cardID === card.id) {
      setState("inpaint", undefined)
      return
    }
    const item = boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
    const url = item && mediaURL(originalMediaSrc(item.media))
    if (!item || !url) return
    batch(() => {
      setState("outpaint", undefined)
      setState("video", undefined)
      setState("upscaleCardID", "")
      setState("menuTab", "")
      setState("inpaintMode", "qwen_image_edit")
      setState("inpaintBrush", 40)
      setState("inpaintPrompt", "")
      setState("inpaintError", "")
      setState("inpaint", { cardID: card.id, generationID: item.generationID, mediaID: item.mediaID, image: originalMediaSrc(item.media), url })
    })
    updateAnchor()
  }
  function generateInpaint() {
    if (!state.inpaint || busy() || !inpaintDrawing.state.ready) return
    inpaintDrawing.finish()
    if (!inpaintDrawing.state.hasDrawing && !state.inpaintPrompt.trim()) return
    try {
      generateDerived("image.inpaint", {
        prompt: state.inpaintPrompt.trim(), mode: state.inpaintMode, brushSize: state.inpaintBrush,
        sourceImage: state.inpaint.image, compositeImage: inpaintDrawing.composite(), hasDrawing: inpaintDrawing.state.hasDrawing,
      })
    } catch (error) {
      setState("inpaintError", boardErrorMessage(error))
    }
  }
  function toggleOutpaint() {
    const card = selected()
    if (!card || card.kind !== "image" || busy() || editingBlocked(card)) return
    if (state.outpaint?.cardID === card.id) {
      setState("outpaint", undefined)
      return
    }
    const item = boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
    const url = item && mediaURL(originalMediaSrc(item.media))
    if (!item || !url) return
    batch(() => {
      setState("upscaleCardID", "")
      setState("inpaint", undefined)
      setState("menuTab", "")
      setState("video", undefined)
      setState("outpaintPrompt", "")
      setState("outpaintError", "")
      setState("outpaint", { cardID: card.id, generationID: item.generationID, mediaID: item.mediaID, url })
    })
    updateAnchor()
  }
  function generateOutpaint() {
    if (!state.outpaint || !outpaintEditor.canSubmit()) return
    outpaintEditor.finish()
    generateDerived("image.outpaint", undefined, outpaintEditor.input(state.outpaintPrompt))
  }
  function toggleVideo() {
    const card = selected()
    if (!card || card.kind !== "image" || props.demo || busy() || editingBlocked(card) ||
      state.saveError || studioPermissionState.status !== "ready" || !studioPermissionState.video) return
    if (state.video?.cardID === card.id) { setState("video", undefined); return }
    const item = boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
    if (!item) return
    batch(() => {
      setState("menuTab", "")
      setState("upscaleCardID", "")
      setState("inpaint", undefined)
      setState("outpaint", undefined)
      setState("video", { cardID: card.id, source: {
        sourceID: card.id, generationID: item.generationID, mediaID: item.mediaID,
        title: card.title, image: originalMediaSrc(item.media), role: "firstFrame",
      } })
    })
    updateAnchor()
  }
  async function uploadVideoFiles(files: File[]) {
    const assets: BoardCard["draft"]["assets"] = []
    setState("derivedPreparing", true)
    await enqueueWrite(async () => {
      const sessionID = await ensureSession()
      if (disposed || !sessionID) throw new Error("无法创建画布会话")
      const results = await Promise.allSettled(files.map(async (file) => {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("读取图片失败"))
          reader.onerror = () => reject(new Error("读取图片失败"))
          reader.readAsDataURL(file)
        })
        const id = crypto.randomUUID()
        const uploaded = await request<{ path: string }>("/artifact/upload", "POST", {
          sessionId: sessionID, filename: `board-${id}.${file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png"}`,
          content: data.slice(data.indexOf(",") + 1),
        })
        if (!uploaded.path) throw new Error("上传失败，未返回素材路径")
        return { id, name: file.name, url: uploaded.path, role: "reference" as const }
      }))
      assets.push(...results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []))
      const failure = results.find((result) => result.status === "rejected")
      if (failure) notify(boardErrorMessage(failure.reason))
    }).finally(() => { if (!disposed) setState("derivedPreparing", false) })
    return assets
  }
  function nextCardPosition(source: BoardCard) {
    const bounds = state.document.cards.map((card) => {
      const node = graph?.getCellById(card.id)
      return { id: card.id, ...(node?.isNode() ? node.getBBox() : {
        ...card.position, ...(cardSizes.get(card.id) ?? { width: WIDTH, height: HEIGHT }),
      }) }
    })
    return boardNextCardPosition(bounds.find((rect) => rect.id === source.id)!, bounds)
  }
  function focusCreatedCard(card: BoardCard) {
    select(card.id)
    const node = graph?.getCellById(card.id)
    if (!node?.isNode()) return
    const point = graph!.localToClient(node.getBBox().center)
    const bounds = board.getBoundingClientRect()
    if (point.x + node.size().width * state.zoom / 2 > bounds.right - 32 ||
      point.y + node.size().height * state.zoom / 2 > bounds.bottom - 32 ||
      point.x - node.size().width * state.zoom / 2 < bounds.left + 32 ||
      point.y - node.size().height * state.zoom / 2 < bounds.top + 32)
      graph!.centerCell(node)
  }
  function regenerate(source: BoardCard) {
    if (busy() || editingBlocked(source) || state.saveError) return
    const item = boardMedia(source, state.results).find((item) => item.media === boardDisplayedMedia(source, state.results))
    const link = item && source.taskLinks.find((link) => link.generationID === item.generationID)
    if (!link) { notify("找不到原任务参数，请刷新后重试"); return }
    const snapshot = BoardSnapshot.parse(link.snapshot)
    const error = boardGenerationError(source.kind, snapshot)
    if (error) { notify(error); return }
    const card = newBoardCard(crypto.randomUUID(), source.kind, nextCardPosition(source))
    card.operation = snapshot.operation
    card.regeneration = { sourceID: source.id, generationID: link.generationID, snapshot: BoardSnapshot.parse(snapshot) }
    card.draft = { prompt: snapshot.prompt, settings: { ...snapshot.settings }, assets: [], references: snapshot.references.map((reference) => ({ ...reference })) }
    if (!props.demo && !snapshot.operation && !boardCanGenerate(card, studioPermissionState)) {
      notify("请先加载模型权限或选择有权限的模型")
      return
    }
    const name = card.operation ? boardImageOperationName(card.operation.capability) : card.kind === "image" ? "图片" : "视频"
    card.title = `${name} ${String(state.document.cards.filter((item) => card.operation
      ? item.operation?.capability === card.operation.capability : item.kind === card.kind && !item.operation).length + 1).padStart(2, "0")}`
    setState("document", "cards", (cards) => [...cards, card])
    mountCard(card)
    focusCreatedCard(card)
    void sendGeneration(card, snapshot)
  }
  function generateVideo(input: BoardCard, reference?: BoardReference) {
    const source = selected()
    if (!source || state.video?.cardID !== source.id || busy() || editingBlocked(source) || state.saveError ||
      !boardCanGenerate(input, studioPermissionState)) return
    const card = newBoardCard(input.id, "video", nextCardPosition(source))
    card.title = `视频 ${String(state.document.cards.filter((card) => card.kind === "video").length + 1).padStart(2, "0")}`
    card.draft = { prompt: input.draft.prompt.trim(), settings: { ...input.draft.settings }, assets: input.draft.assets.map((asset) => ({ ...asset })) }
    const edge = reference ? { id: crypto.randomUUID(), sourceID: reference.sourceID, targetID: card.id,
      role: reference.role, reference: { ...reference } } : undefined
    const document = { ...state.document, cards: [...state.document.cards, card], draftEdges: edge ? [...state.document.draftEdges, edge] : [...state.document.draftEdges] }
    const error = boardGenerationError("video", { ...card.draft, references: boardReferences(document, card.id, state.results) })
    if (error) { notify(error); return }
    batch(() => {
      setState("document", "cards", document.cards)
      setState("document", "draftEdges", document.draftEdges)
    })
    mountCard(card)
    if (edge) graph?.addEdge({ ...edgeStyle, id: edge.id, source: cardTerminal(source.id, "output"), target: cardTerminal(card.id, edge.role) })
    focusCreatedCard(card)
    tracker.interaction({ module: "studio", name: "video", extend: JSON.stringify({ inputMode: card.draft.settings.videoInputMode, hasSourceImage: !!reference }) })
    void generate(card.id)
  }
  async function submitDerived(card: BoardCard, retry = false) {
    if (!card.operation || disposed) return
    operations.start(card.id, "creating")
    setState("submissionErrors", card.id, "")
    const snapshot = BoardSnapshot.parse({ ...card.draft, references: [], operation: card.operation })
    await persistBoard(retry)
    if (disposed || !state.sessionID) return
    await submit({
      sessionID: state.sessionID,
      capability: card.operation.capability,
      prompt: snapshot.prompt,
      extra: { userIdx: props.userIdx },
      board: { cardID: card.id, submissionID: crypto.randomUUID(), revision: state.revision, snapshot },
    })
  }
  function retryDerived(card: BoardCard) {
    if (busy() || editingBlocked(card) || !card.operation || card.currentGenerationID) return
    void enqueueWrite(() => submitDerived(card, true)).catch((error: unknown) => {
      operations.finish(card.id)
      setState("submissionErrors", card.id, boardErrorMessage(error))
      notify(boardErrorMessage(error))
    })
  }
  function generateDerived(capability: "image.upscale" | "image.cutout" | "image.inpaint" | "image.outpaint", input?: StudioInpaintInput, outpaint?: StudioOutpaintInput) {
    const source = selected()
    if (!source || source.kind !== "image" || busy() || editingBlocked(source) || state.saveError) return
    const item = boardMedia(source, state.results).find((item) => item.media === boardDisplayedMedia(source, state.results))
    const url = item && mediaURL(originalMediaSrc(item.media))
    if (!item || !url) return
    if (capability === "image.inpaint" && !input) return
    if (capability === "image.outpaint" && !outpaint) return
    const mode = state.upscaleMode
    const name = boardImageOperationName(capability)
    const sourceRef = {
      sourceID: source.id,
      generationID: item.generationID,
      mediaID: item.mediaID,
      title: source.title,
      image: originalMediaSrc(item.media),
      role: "reference" as const,
    }
    const matches = () => {
      const card = state.document.cards.find((card) => card.id === source.id)
      const displayed = card && boardMedia(card, state.results).find((item) => item.media === boardDisplayedMedia(card, state.results))
      return !disposed && !state.exiting &&
        (capability === "image.outpaint" ? state.outpaint?.cardID : capability === "image.inpaint" ? state.inpaint?.cardID : capability === "image.upscale" ? state.upscaleCardID : state.cutoutCardID) === source.id &&
        displayed?.generationID === sourceRef.generationID && displayed.mediaID === sourceRef.mediaID
    }
    batch(() => {
      if (capability === "image.cutout") {
        setState("video", undefined)
        setState("outpaint", undefined)
        setState("inpaint", undefined)
        setState("upscaleCardID", "")
        setState("cutoutCardID", source.id)
        setState("menuTab", "")
      }
      setState("derivedPreparing", true)
      setState("inpaintError", "")
      setState("outpaintError", "")
    })
    void enqueueWrite(async () => {
      const expanded = outpaint ? await prepareStudioOutpaintImage(url, outpaint.extra) : undefined
      const prepared = expanded ?? await prepareStudioImageOperation(url, capability)
      const composite = input ? await resizeStudioCompositeImage(input.compositeImage, prepared.sourceImage) : undefined
      if (!matches()) return
      const sessionID = props.demo ? undefined : await ensureSession()
      if (!props.demo && !sessionID) throw new Error("无法创建画布会话")
      const uploads = props.demo ? [] : await Promise.allSettled([
        { data: prepared.sourceImage, name: `${capability.replace("image.", "")}-source.jpg` },
        ...(composite ? [{ data: composite, name: "inpaint-composite.png" }] : []),
      ].map((image) => request<{ path: string }>("/artifact/upload", "POST", {
        sessionId: sessionID,
        filename: `${crypto.randomUUID()}-${image.name}`,
        content: image.data.slice(image.data.indexOf(",") + 1),
      })))
      const failed = uploads.find((upload) => upload.status === "rejected")
      if (failed) throw failed.reason
      const uploaded = uploads.flatMap((upload) => upload.status === "fulfilled" ? [upload.value] : [])
      if (!matches()) return
      if (!props.demo && (!uploaded[0]?.path || (composite && !uploaded[1]?.path))) throw new Error("上传失败，未返回素材路径")
      const card = newBoardCard(crypto.randomUUID(), "image", nextCardPosition(source))
      card.title = `${name} ${String(state.document.cards.filter((card) => card.operation?.capability === capability).length + 1).padStart(2, "0")}`
      card.operation = {
        ...(capability === "image.outpaint" ? {
          capability, ...expanded!.metrics, ratio: outpaint!.extra.ratio,
        } : capability === "image.inpaint" ? {
          capability, generateMode: input!.mode, brushSize: input!.brushSize,
          hasDrawing: input!.hasDrawing, compositeImage: uploaded[1]?.path ?? composite!,
        } : capability === "image.upscale" ? { capability, mode } : { capability }),
        source: sourceRef,
        sourceImage: uploaded[0]?.path ?? prepared.sourceImage,
      }
      card.draft.prompt = outpaint ? outpaint.prompt || STUDIO_OUTPAINT_PROMPT : input ? studioInpaintPrompt(input) : capability === "image.upscale" ? BOARD_UPSCALE_PROMPT : BOARD_CUTOUT_PROMPT
      card.draft.settings = { ...card.draft.settings, aspectRatio: prepared.aspectRatio, count: 1 }
      const edge = { id: crypto.randomUUID(), sourceID: source.id, targetID: card.id, role: "reference" as const, purpose: "derivation" as const }
      batch(() => {
        setState("document", "cards", (cards) => [...cards, card])
        setState("document", "draftEdges", (edges) => [...edges, edge])
      })
      mountCard(card)
      graph?.addEdge({ ...edgeStyle, id: edge.id, source: cardTerminal(source.id, "output"), target: cardTerminal(card.id, "reference") })
      focusCreatedCard(card)
      tracker.interaction({ module: "studio", name: capability.replace("image.", ""), extend: JSON.stringify({
        ...(capability === "image.upscale" ? { mode } : {}),
        ...(input ? { mode: input.mode, brushSize: input.brushSize, hasDrawing: input.hasDrawing, hasCustomPrompt: !!input.prompt } : {}),
        ...(outpaint ? { aspectRatio: prepared.aspectRatio, hasCustomPrompt: !!outpaint.prompt } : {}),
        hasSourceImage: true, isUploadedImage: false,
      }) })
      if (props.demo) {
        simulate(card.id, BoardSnapshot.parse({ ...card.draft, references: [], operation: card.operation }))
        return
      }
      await submitDerived(card).catch((error: unknown) => {
        operations.finish(card.id)
        setState("submissionErrors", card.id, boardErrorMessage(error))
        throw error
      })
    }).catch((error: unknown) => {
      if (!disposed) {
        if (capability === "image.inpaint") setState("inpaintError", boardErrorMessage(error))
        if (capability === "image.outpaint") setState("outpaintError", boardErrorMessage(error))
        notify(boardErrorMessage(error, `${name}提交失败，请重试`))
      }
    }).finally(() => {
      if (!disposed) {
        setState("derivedPreparing", false)
        setState("cutoutCardID", "")
      }
    })
  }
  function updateAnchor() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!graph || disposed) return
      setState("zoom", graph.zoom())
      const node = selected() && graph.getCellById(selected()!.id)
      if (!node?.isNode()) return
      const bounds = board.getBoundingClientRect()
      const point = graph.localToClient(node.getBBox().bottomCenter)
      const width = Math.min(544, bounds.width - 32)
      setState("anchor", {
        left: point.x - bounds.left - width / 2,
        top: point.y - bounds.top + 16,
        width,
      })
      const bottomLeft = graph.localToClient(node.getBBox().bottomLeft)
      const inpaintWidth = Math.min(488, bounds.width - 32)
      setState("inpaintAnchor", {
        left: Math.max(16, Math.min(bounds.width - inpaintWidth - 16, bottomLeft.x - bounds.left)),
        top: Math.max(80, Math.min(bounds.height - 202, bottomLeft.y - bounds.top + 12)),
        width: inpaintWidth,
      })
      const outpaintWidth = Math.min(440, bounds.width - 32)
      setState("outpaintAnchor", {
        left: Math.max(16, Math.min(bounds.width - outpaintWidth - 16, bottomLeft.x - bounds.left)),
        top: Math.max(80, Math.min(bounds.height - 130, bottomLeft.y - bounds.top + 12)),
        width: outpaintWidth,
      })
      const top = graph.localToClient(node.getBBox().topCenter)
      const toolbarMargin = Math.min((selected()?.kind === "video" ? 176 : 581) / 2 + 16, bounds.width / 2)
      setState("mediaToolbarAnchor", {
        left: Math.max(toolbarMargin, Math.min(bounds.width - toolbarMargin, top.x - bounds.left)),
        top: state.outpaint ? Math.max(116, top.y - bounds.top - 12) : top.y - bounds.top - 12,
      })
      updateDropdown()
    })
  }
  function updateDropdown() {
    const button = menuButtons.get(state.menuTab)
    if (!dropdown || !composer || !button || disposed) return
    const bounds = board.getBoundingClientRect()
    const anchor = button.getBoundingClientRect()
    const origin = composer.getBoundingClientRect()
    dropdown.style.maxWidth = `${bounds.width - 32}px`
    const menu = dropdown.firstElementChild
    if (menu instanceof HTMLElement) menu.style.maxHeight = `${bounds.height - 100}px`
    const popup = dropdown.getBoundingClientRect()
    const above = anchor.top - popup.height - 8
    const top = above >= bounds.top + 80 ? above : anchor.bottom + 8
    dropdown.style.left = `${Math.max(bounds.left + 16, Math.min(bounds.right - popup.width - 16, anchor.left)) - origin.left}px`
    dropdown.style.top = `${Math.max(bounds.top + 80, Math.min(bounds.bottom - popup.height - 16, top)) - origin.top}px`
    dropdown.style.visibility = "visible"
  }
  function select(id: string, multiple = false) {
    if (selected()?.id !== id || multiple) {
      setState("upscaleCardID", "")
      setState("cutoutCardID", "")
      setState("video", undefined)
      setState("inpaint", undefined)
      setState("outpaint", undefined)
    }
    if (!multiple) setState("selectedIDs", id ? [id] : [])
    if (multiple)
      setState("selectedIDs", (ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
    setState("menuTab", "")
    updateAnchor()
  }
  function updateCard(id: string, change: Partial<BoardCard>) {
    setState("document", "cards", (card) => card.id === id, change)
    updatePorts()
  }
  function editCard(id: string, change: Partial<BoardCard>) {
    if (awaitingRecovery()) return
    updateCard(id, change)
  }
  function draftSetting<K extends keyof BoardSettings>(id: string, key: K, value: BoardSettings[K]) {
    const card = state.document.cards.find((card) => card.id === id)
    if (!card || editingBlocked(card)) return
    setState("document", "cards", (card) => card.id === id, "draft", "settings", key, value)
    updateAnchor()
  }
  function swapVideoFrames(card: BoardCard) {
    if (editingBlocked(card)) return
    const swap = (role: "reference" | "firstFrame" | "lastFrame") =>
      role === "firstFrame" ? ("lastFrame" as const) : role === "lastFrame" ? ("firstFrame" as const) : role
    batch(() => {
      setState("document", "cards", (item) => item.id === card.id, "draft", "references",
        (references) => references?.map((reference) => ({ ...reference, role: swap(reference.role) })))
      setState(
        "document",
        "cards",
        (item) => item.id === card.id,
        "draft",
        "assets",
        (assets) => assets.map((asset) => ({ ...asset, role: swap(asset.role) })),
      )
      setState("document", "draftEdges", (edges) =>
        edges.map((edge) => (edge.targetID === card.id ? { ...edge, role: swap(edge.role),
          reference: edge.reference ? { ...edge.reference, role: swap(edge.reference.role) } : undefined } : edge)),
      )
    })
  }
  function closeMenu() {
    if (temporaryEdge) graph?.removeCell(temporaryEdge)
    temporaryEdge = undefined
    setState("menu", undefined)
  }
  function changeTool(tool: "select" | "pan") {
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    closeMenu()
    stopFlow()
    selectionStart = undefined
    batch(() => {
      setState("tool", tool)
      setState("toolMenu", false)
      setState("temporaryPan", false)
      setState("marquee", undefined)
      setState("draggingCard", false)
      setState("guides", { x: undefined, y: undefined })
    })
    if (!graph) return
    graph.options.panning.eventTypes = tool === "pan" ? ["leftMouseDown", "mouseWheelDown"] : ["mouseWheelDown"]
    graph.enablePanning()
  }
  function openMenu(x: number, y: number, sourceID?: string, previewID?: string) {
    if (!graph || awaitingRecovery()) return
    const bounds = board.getBoundingClientRect()
    setState("menu", {
      x: Math.max(12, Math.min(bounds.width - 205, x - bounds.left)),
      y: Math.max(76, Math.min(bounds.height - 120, y - bounds.top)),
      point: graph.clientToLocal(x, y),
      sourceID,
      previewID,
    })
    queueMicrotask(() => board.querySelector<HTMLButtonElement>(".studio-board-create-menu button")?.focus())
  }
  function finishBlankEdge(edge: Edge) {
    if (awaitingRecovery()) {
      graph?.removeCell(edge)
      return
    }
    if (!graph?.getCellById(edge.id) || edge.getTargetCellId() || state.menu?.previewID === edge.id) return
    const sourceID = edge.getSourceCellId()

    const point = graph!.localToClient(edge.getTargetPoint())
    const bounds = board.getBoundingClientRect()
    const invalid =
      point.x < bounds.left ||
      point.x > bounds.right ||
      point.y < bounds.top ||
      point.y > bounds.bottom ||
      document
        .elementsFromPoint(point.x, point.y)
        .some((element) =>
          element.closest(
            ".x6-node, .studio-board-composer, .studio-board-tools, .studio-board-header, .studio-board-results",
          ),
        )
    if (invalid) {
      graph?.removeCell(edge)
      return
    }
    temporaryEdge = edge
    openMenu(point.x, point.y, sourceID, edge.id)
    return
  }
  function connect(
    sourceID: string,
    targetID: string,
    role: "reference" | "firstFrame" | "lastFrame" = "reference",
    edge?: Edge,
  ) {
    if (awaitingRecovery()) {
      if (edge) graph?.removeCell(edge)
      return false
    }
    const error = boardConnectionError(state.document, state.results, sourceID, targetID, role)
    const target = state.document.cards.find((card) => card.id === targetID)
    if (error || (target && editingBlocked(target))) {
      if (edge) graph?.removeCell(edge)
      notify(error ?? "请等待目标操作结束后修改引用")
      return false
    }
    const connection =
      edge ??
      graph?.addEdge({
        ...edgeStyle,
        source: { cell: sourceID, port: "output" },
        target: { cell: targetID, port: role },
      })
    if (!connection) return false
    connection.setSource(cardTerminal(sourceID, "output"))
    connection.setTarget(cardTerminal(targetID, role))
    setState("document", "draftEdges", (edges) => [...edges, { id: connection.id, sourceID, targetID, role }])
    if (role !== "reference") draftSetting(targetID, "videoMode", "first_last_frame")
    select(targetID)
    return true
  }
  function addCard(kind: BoardCard["kind"] = "image", fromMenu = false) {
    if (!graph || !state.ready || awaitingRecovery()) return
    if (kind === "video" && (props.demo || !studioPermissionState.video)) return
    const menu = fromMenu ? state.menu : undefined
    const bounds = board.getBoundingClientRect()
    const center =
      menu?.point ?? graph.clientToLocal(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2 - 50)
    const origin = { x: center.x - (menu?.sourceID ? -20 : WIDTH / 2), y: center.y - HEIGHT / 2 }
    // Allow overlapping cards; only stagger nearly identical top-left positions.
    const point = Array.from({ length: state.document.cards.length + 1 }, (_, index) => ({
      x: origin.x + index * 24,
      y: origin.y + index * 24,
    })).find((item) =>
      state.document.cards.every(
        (card) =>
          Math.abs(item.x - card.position.x) >= 12 || Math.abs(item.y - card.position.y) >= 12,
      ),
    )!
    const card = newBoardCard(crypto.randomUUID(), kind, point)
    if (kind === "video") card.draft.settings.videoInputMode = "first-last-frame"
    card.title = `${kind === "image" ? "图片" : "视频"} ${String(state.document.cards.filter((item) => item.kind === kind).length + 1).padStart(2, "0")}`
    if (kind === "image" && !props.demo && studioPermissionState.status === "ready")
      card.draft.settings.styleModel = defaultStudioStyleModel(studioPermissionState.seedream)
    setState("document", "cards", (cards) => [...cards, card])
    mountCard(card)
    graph.getCellById(card.id)?.toFront()
    if (menu?.sourceID && !connect(menu.sourceID, card.id, kind === "video" ? "firstFrame" : "reference")) {
      removeCard(card.id)
      closeMenu()
      return
    }
    closeMenu()
    changeTool("select")
    select(card.id)
    if (!props.demo && !state.saveError) void save(false).catch(() => {})
  }
  function removeEdge(id: string) {
    if (awaitingRecovery()) return
    const edge = state.document.draftEdges.find((item) => item.id === id)
    if (!edge) return
    const target = state.document.cards.find((card) => card.id === edge.targetID)
    if (target && locked(target)) {
      notify("请等待任务结束后修改引用")
      return
    }
    stopFlow()
    graph?.removeCell(id)
    setState("document", "draftEdges", (edges) => edges.filter((item) => item.id !== id))
  }
  function removeCard(id: string) {
    if (awaitingRecovery() || state.derivedPreparing) return
    const card = state.document.cards.find((item) => item.id === id)
    if (!card || locked(card)) {
      notify("请先确认活动任务结束")
      return
    }
    if (
      state.document.draftEdges.some(
        (edge) => edge.sourceID === id && locked(state.document.cards.find((item) => item.id === edge.targetID)!),
      )
    ) {
      notify("下游任务进行中，请稍后移除来源")
      return
    }
    setState("selectedIDs", (ids) => ids.filter((item) => item !== id))
    setState("document", "draftEdges", (edges) => edges.filter((edge) => edge.sourceID !== id && edge.targetID !== id))
    graph?.removeCell(id)
    roots.get(id)?.()
    roots.delete(id)
    cardSizes.delete(id)
    hosts.delete(id)
    setState("document", "cards", (cards) => cards.filter((item) => item.id !== id))
    setState("document", "removedCardIDs", (ids) => [...new Set([...ids, id])])
    closeMenu()
  }
  function updatePorts() {
    state.document.cards.forEach((card) => {
      const node = graph?.getCellById(card.id)
      if (!node?.isNode()) return
      if (card.kind === "image")
        node.portProp("output", "attrs/circle", {
          magnet: !!boardCover(card, state.results),
          opacity: 1,
        })
      node
        .getPorts()
        .filter((port) => port.id !== "output")
        .forEach((port) => {
          const blocked =
            !!card.operation ||
            editingBlocked(card) ||
            !boardReferenceActive(card.kind, card.draft.settings, port.id!) ||
            (port.id !== "reference" && !!boardFrameSourceCount(state.document, card.id, port.id!))
          node.portProp(port.id!, "attrs/circle", {
            magnet: blocked ? false : "passive",
            opacity: blocked ? 0.35 : 1,
            display: boardReferenceActive(card.kind, card.draft.settings, port.id!) ? "" : "none",
          })
          node.portProp(
            port.id!,
            "attrs/plus/display",
            boardReferenceActive(card.kind, card.draft.settings, port.id!) ? "" : "none",
          )
        })
    })
    state.document.draftEdges.forEach((edge) => {
      const cell = graph?.getCellById(edge.id)
      const card = state.document.cards.find((card) => card.id === edge.targetID)
      if (!cell?.isEdge() || !card) return
      const role = boardEdgeRole(card.kind, card.draft.settings, edge)
      if (cell.getTargetPortId() !== role) cell.setTarget(cardTerminal(card.id, role))
      const active = boardReferenceActive(card.kind, card.draft.settings, role)
      if (cell.isVisible() !== active) cell.setVisible(active)
    })
  }
  function mountCard(card: BoardCard) {
    if (!graph) return
    const id = card.id
    const host = document.createElement("div")
    hosts.set(id, host)
    roots.set(
      id,
      runWithOwner(owner, () =>
        render(() => {
          const item = () => state.document.cards.find((value) => value.id === id)!
          return (
            <Show when={item()}>
              {(value) => (
                <StudioBoardCardView
                  card={value()}
                  results={state.results}
                  operation={operations.state[id]}
                  selected={state.selectedIDs.includes(id)}
                  locked={locked(value())}
                  editingBlocked={editingBlocked(value())}
                  historyCover={state.historyCoverIDs.includes(id)}
                  failureSuppressed={state.suppressedFailureIDs.includes(value().currentGenerationID ?? "")}
                  rebootBlocked={busy() || awaitingRecovery()}
                  mediaURL={mediaURL}
                  playerMount={() => board}
                  onSize={(size) => {
                    cardSizes.set(id, size)
                    const node = graph?.getCellById(id)
                    if (!node?.isNode()) return
                    if (node.size().width === size.width && node.size().height === size.height) return
                    node.resize(size.width, size.height)
                    updateAnchor()
                  }}
                  onOperate={(action) => void operate(id, action)}
                  onRefresh={() => void reconcile(id)}
                  onRemove={() => removeCard(id)}
                  submissionError={!value().currentGenerationID && !locked(value())
                    ? state.submissionErrors[id] || (value().operation ? `${boardImageOperationName(value().operation!.capability)}任务尚未提交，可重新提交` : undefined)
                    : undefined}
                  onRetry={() => value().operation ? retryDerived(value()) : void generate(id, true)}
                  inpaint={state.inpaint?.cardID === id ? inpaintDrawing : undefined}
                  outpaint={state.outpaint?.cardID === id ? outpaintEditor : undefined}
                  outpaintSource={state.outpaint?.cardID === id ? state.outpaint.url : undefined}
                  zoom={state.zoom}
                  onResults={() => {
                    setState("resultsCardID", id)
                    setState("inspectGenerationID", "")
                  }}
                  onPlay={(current) =>
                    board.querySelectorAll("video").forEach((video) => {
                      if (video !== current) video.pause()
                    })
                  }
                />
              )}
            </Show>
          )
        }, host),
      )!,
    )
    const port = (position: "left" | "right") => ({
      position: {
        name: position,
        args: {
          dx: position === "left" ? -21 : 21,
        },
      },
      markup: [
        { tagName: "circle", selector: "circle" },
        { tagName: "path", selector: "plus" },
      ],
      attrs: {
        circle: {
          r: 13,
          magnet: position === "left" ? "passive" : false,
          stroke: "#e1e1e1",
          strokeWidth: 1,
          fill: "#fff",
        },
        plus: {
          d: "M -5.25 0 L 5.25 0 M 0 -5.25 L 0 5.25",
          stroke: "#777",
          strokeWidth: 0.875,
          strokeLinecap: "round",
          pointerEvents: "none",
        },
      },
    })
    graph.addNode({
      id,
      shape: "studio-board-card",
      width: cardSizes.get(id)?.width ?? WIDTH,
      height: cardSizes.get(id)?.height ?? HEIGHT,
      x: card.position.x,
      y: card.position.y,
      zIndex: 1,
      ports: {
        groups: { input: port("left"), output: port("right"), firstFrame: port("left"), lastFrame: port("left") },
        items:
          card.kind === "image"
            ? [
                { id: "reference", group: "input" },
                { id: "output", group: "output" },
              ]
            : [
                { id: "reference", group: "input" },
                { id: "firstFrame", group: "firstFrame", args: { y: "35%" } },
                { id: "lastFrame", group: "lastFrame", args: { y: "65%" } },
              ],
      },
    })
    updatePorts()
  }
  function rebuild() {
    stopFlow()
    closeMenu()
    graph?.clearCells()
    roots.forEach((dispose, id) => {
      dispose()
      hosts.delete(id)
    })
    roots.clear()
    state.document.cards.forEach(mountCard)
    state.document.draftEdges.forEach((edge) =>
      graph?.addEdge({
        ...edgeStyle,
        id: edge.id,
        source: cardTerminal(edge.sourceID, "output"),
        target: cardTerminal(edge.targetID, edge.role),
      }),
    )
    updatePorts()
    graph?.zoomTo(state.document.viewport.zoom)
    graph?.translate(state.document.viewport.x, state.document.viewport.y)
    select("")
  }
  function mergeBoard(value: unknown, replace = false, submission?: BoardSubmission) {
    const response = boardResponse.parse(value)
    if (replace) {
      const cards = new Set(response.document.cards.map((card) => card.id))
      const generations = new Set(
        response.document.cards.flatMap((card) => card.taskLinks.map((link) => link.generationID)),
      )
      Object.keys(operations.state)
        .filter((id) => !cards.has(id))
        .forEach((id) => operations.finish(id))
      reboots.forEach((_, id) => {
        if (!cards.has(id)) reboots.delete(id)
      })
      pending.forEach((item, id) => {
        const accepted = response.document.cards.some((card) =>
          card.taskLinks.some((link) => link.submissionID === item.board.submissionID),
        )
        if (cards.has(id) && !accepted) return
        pending.delete(id)
        if (!reboots.has(id)) operations.finish(id)
      })
      tokens.forEach((token, id) => {
        if (generations.has(id)) return
        tokens.set(id, token + 1)
        clearTimeout(timers.get(id))
        timers.delete(id)
      })
      setState(
        "results",
        reconcileStore(Object.fromEntries(Object.entries(state.results).filter(([id]) => generations.has(id)))),
      )
      setState("suppressedFailureIDs", (ids) => ids.filter((id) => generations.has(id)))
      setState("historyCoverIDs", (ids) => ids.filter((id) => cards.has(id)))
      setState("savedDocumentJSON", boardDocumentJSON(response.document))
      setState("revision", response.revision)
      setState("document", normalizeBoardDraft(response.document))
      rebuild()
      response.pendingReboots.forEach((operation) => {
        reboots.set(operation.cardID, operation.operationID)
        operations.start(operation.cardID, "unknown")
      })
      return
    }
    const conflict = !submission || response.revision !== submission.revision + 1
    batch(() => {
      if (conflict) setState("saveError", "画板已被其他窗口更新，请重新加载后恢复修改")
      if (!conflict) {
        setState("savedDocumentJSON", boardDocumentJSON(response.document))
        setState("revision", response.revision)
      }
      setState("document", "cards", (cards) =>
        cards.map((card) => {
          const remote = response.document.cards.find((item) => item.id === card.id)
          return remote
            ? { ...card, taskLinks: remote.taskLinks, currentGenerationID: remote.currentGenerationID }
            : card
        }),
      )
    })
  }
  function accept(result: StudioGenerationResult) {
    if (disposed || (state.results[result.id]?.updatedAt ?? 0) > (result.updatedAt ?? 0)) return
    if (!state.document.cards.some((card) => card.taskLinks.some((link) => link.generationID === result.id))) return
    const wasBusy = boardBusy(state.results[result.id])
    setState("results", result.id, result)
    state.document.cards
      .filter((card) => card.taskLinks.some((link) => link.visible && link.generationID === result.id))
      .forEach((card) => {
        if (result.status === "succeeded" && result.images.some((image) => (image.kind ?? "image") !== card.kind))
          notify("部分生成结果的媒体类型与卡片不匹配，已保留原任务并排除异常媒体")
        const images = boardMedia(card, state.results)
        const first = images.find((image) => image.generationID === result.id)
        if (first && !card.cover)
          updateCard(card.id, { cover: { generationID: first.generationID, mediaID: first.mediaID } })
        if (
          first &&
          card.currentGenerationID === result.id &&
          card.preview?.generationID !== result.id &&
          (!card.preview || wasBusy)
        )
          updateCard(card.id, { preview: { generationID: first.generationID, mediaID: first.mediaID } })
      })
    updatePorts()
  }
  function poll(id: string) {
    clearTimeout(timers.get(id))
    const token = tokens.get(id) ?? 0
    const tick = () =>
      request<StudioGenerationResult>(`/studio/generations/${encodeURIComponent(id)}`)
        .then((result) => {
          if (disposed || tokens.get(id) !== token) return
          accept(result)
          if (boardBusy(result) && result.status !== "abnormal") timers.set(id, setTimeout(tick, 2000))
        })
        .catch((error: unknown) => {
          if (!disposed && tokens.get(id) === token) {
            notify(`状态读取失败：${boardErrorMessage(error)}`)
            timers.set(id, setTimeout(tick, 5000))
          }
        })
    tokens.set(id, token)
    void tick()
  }
  async function ensureSession() {
    if (state.sessionID) return state.sessionID
    if (!creating)
      creating = props
        .createSession(state.creationID)
        .then((id) => {
          if (!id) throw new Error("创建画布会话失败")
          if (disposed) return
          const oldKey = backupKey()
          setState("sessionID", id)
          writeBackup()
          localStorage.removeItem(oldKey)
          props.onSessionCreated(id)
          return id
        })
        .finally(() => {
          creating = undefined
        })
    return creating
  }
  function writeBackup() {
    if (props.demo || disposed || !state.ready || awaitingRecovery()) return Promise.resolve(false)
    const key = backupKey()
    const value = {
      creationID: state.creationID,
      revision: state.revision,
      document: state.document,
      pending: [...pending.values()],
      reboots: [...reboots].map(([cardID, operationID]) => ({ cardID, operationID })),
      suppressed: state.suppressedFailureIDs,
    }
    return Promise.resolve()
      .then(() => {
        localStorage.setItem(key, JSON.stringify(value))
        return true
      })
      .catch(() => {
        notify("本地草稿备份失败，请及时保存")
        return false
      })
  }
  function enqueueWrite(work: () => Promise<void>) {
    const operation = saveChain.catch(() => {}).then(work)
    saveChain = operation.catch(() => {})
    return operation
  }
  function save(retry = true) {
    clearTimeout(saveTimer)
    if (props.demo || !state.ready) return Promise.resolve()
    return enqueueWrite(() => persistBoard(retry))
  }
  function rename(title: string) {
    if (props.demo) return Promise.resolve()
    const change = enqueueWrite(async () => {
      const id = await ensureSession()
      if (!id || disposed) throw new Error("创建画布会话失败")
      if (props.onRenameSession) {
        await props.onRenameSession(id, title)
        return
      }
      await request(`/session/${encodeURIComponent(id)}`, "PATCH", { title })
    })
    titleChange = change
    return change.finally(() => {
      if (titleChange === change) titleChange = undefined
    })
  }
  function leave(action: () => void | Promise<void>) {
    if (state.exiting) return
    const changingTitle = titleChange
    setState("menuTab", "")
    setState("exiting", true)
    clearTimeout(saveTimer)
    void enqueueWrite(async () => {
      if (disposed) return
      await changingTitle
      if (awaitingRecovery() || props.demo || (!state.sessionID && !state.document.cards.length)) {
        if (!props.demo && !state.sessionID && !awaitingRecovery()) localStorage.removeItem(backupKey())
        await action()
        return
      }
      if (pending.size || reboots.size) {
        if ((await writeBackup()) && !disposed) await action()
        return
      }
      await persistBoard(true)
      if (!disposed) await action()
    })
      .catch((error: unknown) => notify(`无法离开画布：${boardErrorMessage(error)}`))
      .finally(() => {
        if (!disposed) setState("exiting", false)
      })
  }
  async function persistBoard(retry = false) {
    if (disposed) return
    if (awaitingRecovery()) throw new Error("请先完成画板读取与草稿恢复")
    // A lost submission response must be reconciled before any revision-changing write.
    // Keep the dirty document and backup; reconciliation will resume autosave.
    if (pending.size || reboots.size) throw new Error("请先核对未确认的生成操作，再保存画板")
    if (state.saveError && !retry) throw new Error(state.saveError)
    setState("saving", true)
    await ensureSession()
      .then(async (id) => {
        if (!id || disposed) return
        const document = boardDocumentSnapshot(state.document)
        const response = boardResponse.parse(
          await request(`/studio/sessions/${encodeURIComponent(id)}/board`, "PUT", {
            revision: state.revision,
            document,
          }),
        )
        if (disposed) return
        setState("savedDocumentJSON", boardDocumentJSON(response.document))
        setState("revision", response.revision)
        setState("saveError", "")
        writeBackup()
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState("saveError", boardErrorMessage(error))
          writeBackup()
        }
        throw error
      })
      .finally(() => {
        if (!disposed) setState("saving", false)
      })
  }
  function restoreInitialBackup() {
    const backup = initialBackup
    if (!backup) return
    initialBackup = undefined
    setState("creationID", backup.creationID)
    setState("suppressedFailureIDs", backup.suppressed)
    if (state.sessionID && boardDocumentJSON(backup.document) !== state.savedDocumentJSON)
      setState("recovery", boardDocumentJSON(backup.document))
    backup.reboots.forEach((item) => {
      if (!state.document.cards.some((card) => card.id === item.cardID) || reboots.has(item.cardID)) return
      reboots.set(item.cardID, item.operationID)
      operations.start(item.cardID, "unknown")
    })
    backup.pending.forEach((item) => {
      if (!state.document.cards.some((card) => card.id === item.board.cardID)) return
      if (
        state.document.cards.some((card) =>
          card.taskLinks.some((link) => link.submissionID === item.board.submissionID),
        )
      )
        return
      pending.set(item.board.cardID, item)
      operations.start(item.board.cardID, "unknown")
    })
    if (pending.size) notify("有提交结果尚未确认，请点击对应卡片的刷新状态核对")
  }
  async function initialize() {
    if (disposed || props.demo || state.initializing || state.loading) return
    setState({ initializing: true, error: "" })
    await Promise.resolve()
      .then(async () => {
        if (!initialBackup) initialBackup = await readBoardBackup(backupKey())
        if (disposed) return
        if (state.sessionID) {
          await reload()
          return
        }
        if (initialBackup && !window.confirm("发现尚未保存的画布草稿，是否恢复？")) initialBackup = undefined
        if (initialBackup) {
          setState("document", normalizeBoardDraft(initialBackup.document))
          rebuild()
          restoreInitialBackup()
        }
        setState("ready", true)
      })
      .catch((error: unknown) => {
        if (!disposed) setState("error", boardErrorMessage(error))
      })
      .finally(() => {
        if (!disposed) setState("initializing", false)
      })
  }
  async function reload(preserveDraft = false) {
    if (!state.sessionID || state.loading) return
    setState("menuTab", "")
    await Promise.resolve()
    const draft = preserveDraft ? documentJSON() : undefined
    if (draft) setState("recovery", draft)
    setState({ loading: true, error: "" })
    await request(`/studio/sessions/${encodeURIComponent(state.sessionID)}/board`)
      .then((response) => {
        if (disposed) return
        mergeBoard(response, true)
        if (draft === state.savedDocumentJSON) setState("recovery", "")
        setState({ ready: true, saveError: "" })
        restoreInitialBackup()
        state.document.cards.flatMap((card) => card.taskLinks).forEach((link) => poll(link.generationID))
      })
      .catch((error: unknown) => {
        if (!disposed) setState("error", boardErrorMessage(error))
      })
    if (!disposed) setState("loading", false)
  }
  async function reconcile(cardID: string) {
    const item = pending.get(cardID)
    if (item) {
      await enqueueWrite(() => submit(item))
      return
    }
    if (reboots.has(cardID)) {
      await operate(cardID, "reboot", reboots.get(cardID))
      return
    }
    const card = state.document.cards.find((value) => value.id === cardID)
    if (!card?.currentGenerationID) return
    const id = card.currentGenerationID
    tokens.set(id, (tokens.get(id) ?? 0) + 1)
    await request<StudioGenerationResult>(
      `/studio/generations/${encodeURIComponent(id)}${state.results[id]?.status === "abnormal" ? "/refresh" : ""}`,
      state.results[id]?.status === "abnormal" ? "POST" : "GET",
    )
      .then((result) => {
        if (disposed) return
        accept(result)
        operations.finish(cardID)
        poll(id)
      })
      .catch((error: unknown) => notify(boardErrorMessage(error)))
  }
  async function submit(body: BoardGenerationRequest) {
    const submission = body.board
    const cardID = submission.cardID
    pending.set(cardID, body)
    let accepted = false
    writeBackup()
    operations.start(cardID, "creating")
    await request<StudioGenerationResult>("/studio/generations", "POST", body)
      .then(async (result) => {
        accepted = true
        if (disposed || pending.get(cardID)?.board.submissionID !== submission.submissionID) return
        await request(`/studio/sessions/${encodeURIComponent(body.sessionID)}/board`).then(
          (value) =>
            !disposed &&
            pending.get(cardID)?.board.submissionID === submission.submissionID &&
            mergeBoard(value, false, submission),
        )
        if (disposed || pending.get(cardID)?.board.submissionID !== submission.submissionID) return
        pending.delete(cardID)
        operations.finish(cardID)
        accept(result)
        poll(result.id)
        writeBackup()
      })
      .catch((error: unknown) => {
        if (disposed || pending.get(cardID)?.board.submissionID !== submission.submissionID) return
        if (!accepted && error instanceof BoardRequestError && error.status >= 400 && error.status < 500) {
          pending.delete(cardID)
          operations.finish(cardID)
          setState("suppressedFailureIDs", (ids) => ids.filter((id) => id !== submission.replacedGenerationID))
        } else operations.start(cardID, "unknown")
        writeBackup()
        notify(boardErrorMessage(error))
      })
  }
  function pickUpload(role: "reference" | "firstFrame" | "lastFrame") {
    const card = selected()
    if (!card || editingBlocked(card)) return
    setState("menuTab", "")
    uploadRole = role
    uploadCardID = selected()?.id
    if (!uploadInput) return
    uploadInput.multiple = role === "reference"
    uploadInput.click()
  }
  async function upload(files: File[]) {
    const card = state.document.cards.find((item) => item.id === uploadCardID)
    if (!card || editingBlocked(card) || !files.length) return
    const role = uploadRole
    const refs = boardReferences(state.document, card.id, state.results)
    if (
      files.some(
        (file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024,
      )
    ) {
      notify("请选择 10MB 以内的 PNG、JPG 或 WebP 图片")
      return
    }
    if (!boardReferenceActive(card.kind, card.draft.settings, role)) return
    if (
      role !== "reference" &&
      boardFrameSourceCount(state.document, card.id, role) &&
      !refs.some((ref) => ref.role === role)
    ) {
      notify("该帧引用不可用，请先移除后替换")
      return
    }
    if (role !== "reference" && files.length > 1) {
      notify("每个首尾帧槽位仅支持一张图片")
      return
    }
    if (
      files.length + refs.filter((ref) => role === "reference" || ref.role !== role).length >
      (card.kind === "video" ? BOARD_VIDEO_REFERENCE_LIMIT : referenceImageLimit(card.draft.settings.styleModel))
    ) {
      notify("参考图数量超过当前模型上限")
      return
    }
    operations.start(card.id, "uploading")
    await enqueueWrite(async () => {
      if (disposed) return
      await Promise.resolve()
        .then(async () => {
          const sessionID = props.demo ? undefined : await ensureSession()
          if (!props.demo && !sessionID) throw new Error("无法创建画布会话")
          const uploads = await Promise.allSettled(
            files.map(async (file) => {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () =>
                  typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("读取图片失败"))
                reader.onerror = () => reject(new Error("读取图片失败"))
                reader.readAsDataURL(file)
              })
              const id = crypto.randomUUID()
              const persisted = props.demo
                ? undefined
                : await request<{ path: string }>("/artifact/upload", "POST", {
                    sessionId: sessionID,
                    filename: `board-${id}.${file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png"}`,
                    content: data.slice(data.indexOf(",") + 1),
                  })
              if (!props.demo && !persisted?.path) throw new Error("上传失败，未返回素材路径")
              return { id, name: file.name, url: persisted?.path ?? data, role }
            }),
          )
          if (disposed) return
          const assets = uploads.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
          batch(() => {
            setState(
              "document",
              "cards",
              (item) => item.id === card.id,
              "draft",
              "assets",
              (items) => [
                ...items.filter((item) => role === "reference" || !assets.length || item.role !== role),
                ...assets,
              ],
            )
            if (role !== "reference" && assets.length) {
              setState("document", "cards", (item) => item.id === card.id, "draft", "references",
                (references) => references?.filter((reference) => reference.role !== role))
              const removed = state.document.draftEdges.filter(
                (edge) => edge.targetID === card.id && edge.role === role,
              )
              setState("document", "draftEdges", (edges) =>
                edges.filter((edge) => !removed.some((item) => item.id === edge.id)),
              )
              removed.forEach((edge) => graph?.removeCell(edge.id))
            }
            if (role !== "reference" && assets.length)
              setState(
                "document",
                "cards",
                (item) => item.id === card.id,
                "draft",
                "settings",
                "videoMode",
                "first_last_frame",
              )
          })
          const failure = uploads.find((result) => result.status === "rejected")
          if (failure?.status === "rejected") throw failure.reason
        })
        .catch((error: unknown) => notify(boardErrorMessage(error)))
      if (!disposed) {
        operations.finish(card.id)
        updateAnchor()
      }
    })
  }
  async function generate(cardID?: string, retry = false) {
    // ImageSettings commits its local size inputs when the popup is disposed.
    setState("menuTab", "")
    await Promise.resolve()
    const card = cardID ? state.document.cards.find((card) => card.id === cardID) : selected()
    if (
      disposed ||
      state.exiting ||
      !card ||
      busy() ||
      !state.ready ||
      awaitingRecovery() ||
      (state.saveError && !retry) ||
      !card.draft.prompt.trim()
    )
      return
    const settings = card.draft.settings
    const unavailableModelMessage = card.kind === "image" && studioModelUnavailableMessage(settings.styleModel)
    if (unavailableModelMessage) {
      notify(unavailableModelMessage)
      return
    }
    if (!props.demo && !boardCanGenerate(card, studioPermissionState)) {
      notify("请先加载模型权限或选择有权限的模型")
      return
    }
    const refs = boardReferences(state.document, card.id, state.results)
    const error = boardGenerationError(card.kind, {
      prompt: card.draft.prompt,
      settings: { ...settings, styleModel: styleModelId(settings.styleModel) ?? settings.styleModel },
      references: refs,
    })
    if (error) {
      notify(error)
      return
    }
    if (
      state.document.draftEdges
        .filter((edge) => edge.targetID === card.id && boardReferenceActive(card.kind, settings, boardEdgeRole(card.kind, settings, edge)))
        .some((edge) => {
          const source = state.document.cards.find((item) => item.id === edge.sourceID)
          return !source || (!edge.reference && !boardCover(source, state.results))
        })
    ) {
      notify("参考图不可用，请重新选择封面")
      return
    }
    const snapshot = BoardSnapshot.parse({ prompt: card.draft.prompt.trim(), settings, references: refs })
    await sendGeneration(card, snapshot, retry)
  }
  async function sendGeneration(card: BoardCard, snapshot: BoardSnapshot, retry = false) {
    setState("historyCoverIDs", (ids) => ids.filter((id) => id !== card.id))
    if (props.demo) {
      simulate(card.id, snapshot)
      return
    }
    setState("submissionErrors", card.id, "")
    operations.start(card.id, "creating")
    const replacedGenerationID = boardFailed(current(card)) ? card.currentGenerationID : undefined
    if (replacedGenerationID) setState("suppressedFailureIDs", (ids) => [...new Set([...ids, replacedGenerationID])])
    await enqueueWrite(async () => {
      await persistBoard(retry)
      if (disposed) return
      if (!state.sessionID) throw new Error("无法创建画布会话")
      await submit({
        sessionID: state.sessionID,
        capability: snapshot.operation?.capability ?? (card.kind === "image" ? "image.generate" : "video.generate"),
        prompt: snapshot.prompt,
        extra: { userIdx: props.userIdx },
        board: {
          cardID: card.id,
          submissionID: crypto.randomUUID(),
          revision: state.revision,
          snapshot,
          replacedGenerationID,
        },
      })
      if (!state.document.cards.find((item) => item.id === card.id)?.currentGenerationID && !pending.has(card.id))
        setState("submissionErrors", card.id, "任务提交失败，可重新提交")
    }).catch((error: unknown) => {
      operations.finish(card.id)
      setState("submissionErrors", card.id, boardErrorMessage(error))
      setState("suppressedFailureIDs", (ids) => ids.filter((id) => id !== replacedGenerationID))
      writeBackup()
      notify(boardErrorMessage(error))
    })
  }
  function simulate(cardID: string, snapshot: BoardSnapshot, reuseID?: string) {
    const card = state.document.cards.find((item) => item.id === cardID)!
    const id = reuseID ?? `demo_${crypto.randomUUID()}`
    const token = (tokens.get(id) ?? 0) + 1
    tokens.set(id, token)
    if (!reuseID)
      updateCard(cardID, {
        currentGenerationID: id,
        taskLinks: [
          ...card.taskLinks.map((link) =>
            boardFailed(current(card)) && link.generationID === card.currentGenerationID
              ? { ...link, visible: false }
              : link,
          ),
          { generationID: id, submissionID: crypto.randomUUID(), visible: true, snapshot },
        ],
      })
    accept({
      id,
      status: "running",
      capability: snapshot.operation?.capability ?? "image.generate",
      prompt: snapshot.prompt,
      provider: "internel",
      taskId: id,
      model: snapshot.settings.styleModel,
      aspectRatio: snapshot.settings.aspectRatio,
      images: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      progress: 0,
    })
    const tick = () => {
      if (disposed || tokens.get(id) !== token) return
      const progress = Math.min(100, (state.results[id]?.progress ?? 0) + 5)
      accept({
        ...state.results[id],
        progress,
        updatedAt: Date.now(),
        status: progress === 100 ? "succeeded" : "running",
        images:
          progress === 100
            ? Array.from({ length: snapshot.settings.count }, (_, index) => ({
                id: `${id}_${index}`,
                kind: "image" as const,
                url: `/studio/board-demo/${["landscape", "still-life", "architecture"][index % 3]}.svg`,
              }))
            : [],
      })
      if (progress < 100) timers.set(id, setTimeout(tick, 180))
    }
    timers.set(id, setTimeout(tick, 180))
  }
  async function operate(cardID: string, action: "cancel" | "reboot", previousOperationID?: string) {
    if (action === "reboot") {
      // Commit the popup's local inputs before the card becomes locked.
      setState("menuTab", "")
      await Promise.resolve()
    }
    if (disposed) return
    const card = state.document.cards.find((item) => item.id === cardID)
    const result = card && current(card)
    if (
      !card ||
      !result ||
      (operations.state[cardID] && !previousOperationID) ||
      (action === "reboot" && !previousOperationID && awaitingRecovery()) ||
      (action === "reboot" && !previousOperationID && (!boardRebootable(result) || busy()))
    )
      return
    setState("historyCoverIDs", (ids) => ids.filter((id) => id !== cardID))
    if (props.demo) {
      tokens.set(result.id, (tokens.get(result.id) ?? 0) + 1)
      clearTimeout(timers.get(result.id))
      if (action === "cancel") {
        accept({ ...result, status: "failed", rawStatus: 4, error: "用户取消生成", updatedAt: Date.now() })
        return
      }
      simulate(cardID, card.taskLinks.find((link) => link.generationID === result.id)!.snapshot, result.id)
      return
    }
    const operationID = action === "reboot" ? (previousOperationID ?? crypto.randomUUID()) : undefined
    if (operationID) reboots.set(cardID, operationID)
    operations.start(cardID, action === "cancel" ? "cancelling" : "rebooting")
    writeBackup()
    tokens.set(result.id, (tokens.get(result.id) ?? 0) + 1)
    const token = tokens.get(result.id)
    clearTimeout(timers.get(result.id))
    await request<StudioGenerationResult>(
      `/studio/generations/${encodeURIComponent(result.id)}/${action}${operationID ? `?operationID=${encodeURIComponent(operationID)}` : ""}`,
      "POST",
    )
      .then((next) => {
        if (disposed || tokens.get(result.id) !== token) return
        reboots.delete(cardID)
        accept(next)
        operations.finish(cardID)
        poll(result.id)
        writeBackup()
      })
      .catch((error: unknown) => {
        if (!disposed && tokens.get(result.id) === token) {
          if (error instanceof BoardRequestError && error.status === 400) {
            reboots.delete(cardID)
            operations.finish(cardID)
          } else operations.start(cardID, "unknown")
          writeBackup()
          notify(boardErrorMessage(error))
        }
      })
  }
  function flow(edge: Edge) {
    stopFlow()
    if (panning()) return
    if (!state.document.draftEdges.some((item) => item.id === edge.id)) return
    const view = graph?.findViewByCell(edge)
    if (!view) return
    view.container.classList.add("studio-board-edge-hover")
    edge.attr("line/stroke", "#7775e7")
    const reset = () => {
      view.container.classList.remove("studio-board-edge-hover")
      edge.attr("line/stroke", "#a7abc4")
    }
    stopFlow = reset
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const path = view.container.querySelector<SVGPathElement>("path[data-selector=line], path.connection")
    if (!path) return
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    group.style.pointerEvents = "none"
    const dots = Array.from({ length: 24 }, (_, index) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      dot.setAttribute("r", String(2.3 - index / 35))
      dot.setAttribute("fill", `rgb(${92 + index * 3}, ${110 - index}, 238)`)
      dot.setAttribute("opacity", String((1 - index / 24) * 0.95))
      group.append(dot)
      return dot
    })
    view.container.append(group)
    let animation = 0
    const start = performance.now()
    const draw = (now: number) => {
      if (!path.isConnected) return
      const length = path.getTotalLength()
      const progress = ((now - start) / 1800) % 1
      dots.forEach((dot, index) => {
        const point = path.getPointAtLength(((progress - index / 140 + 1) % 1) * length)
        dot.setAttribute("cx", String(point.x))
        dot.setAttribute("cy", String(point.y))
      })
      animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    stopFlow = () => {
      cancelAnimationFrame(animation)
      group.remove()
      reset()
    }
  }
  onMount(() => {
    graph = new Graph({
      container: canvas,
      autoResize: true,
      scaling: { min: BOARD_MIN_ZOOM, max: BOARD_MAX_ZOOM },
      background: { color: "#f7f8fb" },
      grid: { visible: true, size: 24, type: "dot", args: { color: "#d6d9e2", thickness: 1 } },
      panning: { enabled: true, eventTypes: ["mouseWheelDown"] },
      mousewheel: { enabled: false },
      interacting: (view) => ({
        edgeMovable: false,
        arrowheadMovable: false,
        nodeMovable: !panning() && !awaitingRecovery() && state.outpaint?.cardID !== view.cell.id,
        magnetConnectable: !panning() && !awaitingRecovery(),
      }),
      connecting: {
        allowBlank: true,
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowMulti: true,
        snap: { radius: 24 },
        connector: edgeStyle.connector,
        createEdge: () => new Shape.Edge(edgeStyle),
        validateMagnet: ({ cell, magnet }) =>
          !panning() &&
          !awaitingRecovery() &&
          magnet.closest("[port]")?.getAttribute("port") === "output" &&
          state.document.cards.some((card) => card.id === cell.id && !!boardCover(card, state.results)),
        validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort }) =>
          !awaitingRecovery() &&
          (!targetCell ||
            !!(
              sourceCell &&
              sourcePort === "output" &&
              targetPort &&
              state.document.cards.some((card) => card.id === targetCell.id && !editingBlocked(card)) &&
              !boardConnectionError(state.document, state.results, sourceCell.id, targetCell.id, targetPort)
            )),
      },
    })
    graph.on("node:mousedown", ({ node, e }) => {
      if (panning() || e.button !== 0) return
      if (e.button === 0) setState("draggingCard", true)
      if (!e.ctrlKey && !e.metaKey) select(node.id)
    })
    graph.on("node:click", ({ node, e }) => {
      if (!panning() && e.button === 0) select(node.id, e.ctrlKey || e.metaKey)
    })
    graph.on("blank:click", ({ e }) => {
      if ((e && e.button !== 0) || state.marquee || panning()) return
      select("")
      closeMenu()
    })
    graph.on("blank:contextmenu", ({ e }) => {
      e.preventDefault()
      closeMenu()
      openMenu(e.clientX, e.clientY)
    })
    const endDrag = () => {
      setState("draggingCard", false)
      setState("guides", { x: undefined, y: undefined })
    }
    graph.on("node:moving", ({ node }) => {
      if (snapping) return
      setState("draggingCard", true)
      const position = node.position()
      const other = graph!
        .getNodes()
        .filter((item) => item.id !== node.id)
        .map((item) => item.position())
      const x = other.find((item) => Math.abs(item.x - position.x) < 6 / state.zoom)?.x
      const y = other.find((item) => Math.abs(item.y - position.y) < 6 / state.zoom)?.y
      if (x !== undefined || y !== undefined) {
        snapping = true
        node.position(x ?? position.x, y ?? position.y)
        snapping = false
      }
      const point = graph!.localToClient(x ?? position.x, y ?? position.y)
      const bounds = board.getBoundingClientRect()
      setState("guides", {
        x: x === undefined ? undefined : point.x - bounds.left,
        y: y === undefined ? undefined : point.y - bounds.top,
      })
      updateAnchor()
    })
    graph.on("node:moved", ({ node }) => {
      editCard(node.id, { position: node.position() })
      endDrag()
    })
    const viewport = () => {
      closeMenu()
      setState("toolMenu", false)
      if (!awaitingRecovery()) setState("document", "viewport", { ...graph!.translate(), zoom: graph!.zoom() })
      updateAnchor()
    }
    graph.on("scale", viewport)
    graph.on("translate", viewport)
    graph.on("resize", updateAnchor)
    graph.on("edge:connected", ({ edge }) => {
      const sourceID = edge.getSourceCellId()
      const targetID = edge.getTargetCellId()
      if (!targetID) {
        finishBlankEdge(edge)
        return
      }
      connect(sourceID, targetID, edge.getTargetPortId() as "reference" | "firstFrame" | "lastFrame", edge)
    })
    // X6 omits edge:connected when the first drag movement already reaches the drop point.
    graph.on("edge:mouseup", ({ edge }) =>
      queueMicrotask(() => {
        if (!disposed && !state.document.draftEdges.some((item) => item.id === edge.id)) finishBlankEdge(edge)
      }),
    )
    graph.on("edge:click", ({ edge, e }) => {
      if (panning() || e.button !== 0 || !graph?.findViewByCell(edge)?.container.classList.contains("studio-board-edge-hover"))
        return
      removeEdge(edge.id)
    })
    graph.on("edge:mouseenter", ({ edge }) => flow(edge))
    graph.on("edge:mouseleave", () => stopFlow())
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 0.1 || state.menu || inpaintDrawing.state.drawing || outpaintEditor.state.dragging) return
      event.preventDefault()
      wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientHeight : 1)
      wheelPoint = { x: event.clientX, y: event.clientY }
      if (wheelFrame) return
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0
        const next = boardWheelZoom(graph!.zoom(), wheelDelta, 0, board.clientHeight)
        // Without a scroller, X6 expects the zoom center in graph viewport coordinates.
        const center = graph!.clientToGraph(wheelPoint.x, wheelPoint.y)
        graph!.zoomTo(next, { center })
        wheelDelta = 0
      })
    }
    canvas.addEventListener("wheel", wheel, { passive: false })
    const dismissDropdown = (event: Event) => {
      const target = event.target
      if (
        !state.menuTab ||
        !(target instanceof Element) ||
        dropdown?.contains(target) ||
        Array.from(menuButtons.values()).some((button) => button.contains(target))
      )
        return
      setState("menuTab", "")
    }
    const down = (event: PointerEvent) => {
      if (state.fullscreenMedia || board.querySelector(".studio-video-player.fullscreen")) return
      dismissDropdown(event)
      if (!(event.target instanceof Element) || !event.target.closest(".studio-board-tools")) setState("toolMenu", false)
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, input, textarea, video, [contenteditable], .studio-board-create-menu, .studio-board-results",
        )
      )
        return
      closeMenu()
      if (!(event.target instanceof Element) || !event.target.closest(".studio-board-graph")) return
      if (event.button === 1) {
        stopFlow()
        setState("temporaryPan", true)
        return
      }
      if (panning() || event.button !== 0 || awaitingRecovery() || event.target.closest(".x6-node, .x6-edge")) return
      graph?.disablePanning()
      const bounds = board.getBoundingClientRect()
      selectionStart = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        selectedIDs: event.shiftKey || event.ctrlKey || event.metaKey ? [...state.selectedIDs] : [],
      }
    }
    const move = (event: PointerEvent) => {
      if (!selectionStart) return
      const bounds = board.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      if (!state.marquee && Math.hypot(x - selectionStart.x, y - selectionStart.y) < 4) return
      setState("marquee", {
        x: Math.min(selectionStart.x, x),
        y: Math.min(selectionStart.y, y),
        width: Math.abs(x - selectionStart.x),
        height: Math.abs(y - selectionStart.y),
      })
    }
    const up = () => {
      endDrag()
      setState("temporaryPan", false)
      if (!selectionStart) return
      const rect = state.marquee
      const bounds = board.getBoundingClientRect()
      if (rect)
        setState(
          "selectedIDs",
          [...new Set([
            ...selectionStart.selectedIDs,
            ...graph!
              .getNodes()
              .filter((node) => {
                const box = graph!.localToClient(node.getBBox())
                return (
                  box.x >= bounds.left + rect.x &&
                  box.y >= bounds.top + rect.y &&
                  box.right <= bounds.left + rect.x + rect.width &&
                  box.bottom <= bounds.top + rect.y + rect.height
                )
              })
              .map((node) => node.id),
          ])],
        )
      selectionStart = undefined
      graph?.enablePanning()
      setTimeout(() => setState("marquee", undefined), 0)
      updateAnchor()
    }
    const cancel = () => {
      // Release X6's mouse-based drag handlers when a pointer gesture is interrupted.
      document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      endDrag()
      selectionStart = undefined
      setState("temporaryPan", false)
      setState("marquee", undefined)
      graph?.enablePanning()
    }
    board.addEventListener("pointerdown", down, true)
    board.addEventListener("focusin", dismissDropdown, true)
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", cancel)
    window.addEventListener("blur", cancel)
    const observer = new ResizeObserver(updateAnchor)
    observer.observe(board)
    if (!props.demo) void initialize()
    board.focus({ preventScroll: true })
    onCleanup(() => {
      disposed = true
      stopFlow()
      observer.disconnect()
      cancelAnimationFrame(frame)
      cancelAnimationFrame(wheelFrame)
      clearTimeout(saveTimer)
      clearTimeout(noticeTimer)
      timers.forEach(clearTimeout)
      canvas.removeEventListener("wheel", wheel)
      board.removeEventListener("pointerdown", down, true)
      board.removeEventListener("focusin", dismissDropdown, true)
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      document.removeEventListener("pointercancel", cancel)
      window.removeEventListener("blur", cancel)
      graph?.dispose()
      roots.forEach((dispose, id) => {
        dispose()
        hosts.delete(id)
      })
      roots.clear()
    })
  })
  createEffect(() => {
    clearTimeout(saveTimer)
    if (awaitingRecovery()) return
    state.document.cards
      .filter((card) => card.kind === "video")
      .forEach((card) => {
        const mode =
          (card.draft.references ?? []).some((reference) => boardReferenceActive(card.kind, card.draft.settings,
            boardEdgeRole(card.kind, card.draft.settings, { role: reference.role, reference }))) ||
          card.draft.assets.some((asset) => boardReferenceActive(card.kind, card.draft.settings, asset.role)) ||
          state.document.draftEdges.some((edge) => edge.targetID === card.id && boardReferenceActive(card.kind, card.draft.settings, boardEdgeRole(card.kind, card.draft.settings, edge)))
            ? "first_last_frame"
            : "text"
        if (card.draft.settings.videoMode !== mode) draftSetting(card.id, "videoMode", mode)
      })
    if (state.ready && !state.recovery) writeBackup()
    if (
      !props.demo &&
      state.ready &&
      !awaitingRecovery() &&
      (state.sessionID || state.document.cards.length > 0) &&
      dirty() &&
      !state.saveError &&
      !state.saving &&
      !operations.busy()
    ) {
      saveTimer = setTimeout(() => {
        void save(false).catch(() => {})
      }, 500)
    }
  })
  createEffect(() => {
    if (state.menuTab === "references" && !showMentionEntry()) {
      setState("menuTab", "")
      return
    }
    if (!state.menuTab || !selected()) return
    queueMicrotask(updateDropdown)
    const observer = new ResizeObserver(updateDropdown)
    if (dropdown) observer.observe(dropdown)
    onCleanup(() => observer.disconnect())
  })
  createEffect(() => updatePorts())
  createEffect(() => {
    const id = state.sessionID
    if (id) props.onBusy?.(id, busy())
  })
  const latestSuccess = createMemo(
    () =>
      Object.values(state.results)
        .filter((result) => result.status === "succeeded" && result.images.length)
        .sort(
          (a, b) => (b.completedAt ?? b.updatedAt ?? b.createdAt) - (a.completedAt ?? a.updatedAt ?? a.createdAt),
        )[0],
  )
  createEffect(() => {
    const result = latestSuccess()
    if (state.sessionID && result) props.onThumbnail?.(state.sessionID, result)
  })

  return (
    <div
      ref={board}
      inert={state.exiting}
      class="studio-board"
      data-tool={panning() ? "pan" : "select"}
      tabindex={-1}
      aria-label="Studio 画布"
      onKeyDown={(event) => {
        if (state.fullscreenMedia || board.querySelector(".studio-video-player.fullscreen")) return
        if (awaitingRecovery()) return
        if (event.key === "Escape" && state.menuTab) {
          setState("menuTab", "")
          event.stopPropagation()
          return
        }
        if (
          event.isComposing ||
          (event.target instanceof Element && event.target.closest("textarea, input, [contenteditable=true]"))
        )
          return
        if (event.key === "Escape") {
          if (state.toolMenu) {
            setState("toolMenu", false)
            return
          }
          changeTool(state.tool)
          setState("resultsCardID", "")
          select("")
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey && ["v", "h"].includes(event.key.toLowerCase())) {
          event.preventDefault()
          changeTool(event.key.toLowerCase() === "v" ? "select" : "pan")
          return
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          if (panning()) return
          event.preventDefault()
          ;[...state.selectedIDs].forEach(removeCard)
        }
      }}
    >
      <div ref={canvas} class="studio-board-graph" />
      <header class="studio-board-header">
        <StudioBoardHeader
          title={props.title ?? (props.demo ? "演示画布" : "未命名画布")}
          sessionID={state.sessionID}
          status={
            state.saveError ||
            (state.saving ? "保存中…" : state.sessionID ? (dirty() ? "未保存" : "已保存") : "尚未保存")
          }
          pending={dirty() || state.saving || !state.sessionID}
          failed={!!state.saveError}
          disabled={state.exiting}
          thumbnails={props.thumbnails}
          mediaURL={mediaURL}
          loadSessions={props.loadSessions}
          loadThumbnails={props.loadThumbnails}
          onSelect={
            !props.demo && props.onSelectSession
              ? (id) => {
                  if (id === state.sessionID && id) return
                  leave(() => props.onSelectSession?.(id))
                }
              : undefined
          }
          onRename={rename}
          onExit={() => leave(props.onExit)}
          onSave={() => void save().catch(() => {})}
        />
        <div class="studio-board-save">
          <span>
            {props.demo
              ? "模拟生成 · 退出或刷新后不保留内容"
              : state.saveError ||
                (state.saving ? "保存中…" : state.sessionID ? (dirty() ? "未保存" : "已保存") : "尚未保存")}
          </span>
          <Show when={!props.demo}>
            <button
              type="button"
              disabled={!state.ready || awaitingRecovery() || state.saving || busy()}
              onClick={() => void save().catch(() => {})}
            >
              {state.saveError ? "重试保存" : "保存"}
            </button>
          </Show>
          <Show
            when={
              state.saveError ||
              Object.values(operations.state).some((operation) => operation === "unknown" || operation === "rebooting")
            }
          >
            <button
              type="button"
              onClick={() => {
                void reload(true)
              }}
            >
              重新加载
            </button>
          </Show>
        </div>
      </header>
      <Show when={state.recovery && state.ready && !state.loading && !state.error}>
        <div class="studio-board-recovery" role="status">
          发现本地未保存的修改，恢复输入与布局时保留服务端任务结果
          <button
            type="button"
            onClick={() => {
              const document = boardDocumentSnapshot(JSON.parse(state.recovery))
              setState("document", normalizeBoardDraft(recoverBoardDraft(state.document, document)))
              setState("recovery", "")
              rebuild()
            }}
          >
            恢复草稿
          </button>
          <button type="button" onClick={() => setState("recovery", "")}>
            保留服务端版本
          </button>
        </div>
      </Show>
      <Show when={state.initializing || state.loading || state.error}>
        <div class="studio-board-loading" role="status">
          {state.error || "正在加载画板…"}
          <Show when={state.error}>
            <button type="button" onClick={() => void (state.ready ? reload() : initialize())}>
              重试
            </button>
          </Show>
        </div>
      </Show>
      <StudioBoardTools
        tool={state.tool}
        open={state.toolMenu}
        disabled={!state.ready || awaitingRecovery()}
        videoDisabled={!!props.demo || !studioPermissionState.video}
        videoHint={props.demo ? "演示模式暂不支持视频" : !studioPermissionState.video ? "暂无视频生成权限" : "新建视频卡片"}
        onToggle={() => {
          closeMenu()
          setState("menuTab", "")
          setState("toolMenu", (open) => !open)
        }}
        onSelect={changeTool}
        onImage={() => addCard()}
        onVideo={() => addCard("video")}
      />
      <Show when={!state.initializing && !state.loading && !state.error && !state.document.cards.length}>
        <div class="studio-board-empty">
          <div class="studio-board-empty-art">▧</div>
          <h2>从一个想法，开始创作</h2>
          <p>添加图片卡片，用连线延伸你的灵感</p>
          <button type="button" class="studio-board-primary" onClick={() => addCard()}>
            ＋ 新建图片卡片
          </button>
        </div>
      </Show>
      <Show when={state.menu}>
        {(menu) => (
          <div
            class="studio-board-create-menu"
            role="menu"
            style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => addCard("image", true)}>
              ＋ 新建图片卡片
            </button>
            <Show when={!props.demo && studioPermissionState.video}>
              <button type="button" role="menuitem" onClick={() => addCard("video", true)}>
                ▷ 新建视频卡片
              </button>
            </Show>
            <button type="button" role="menuitem" onClick={closeMenu}>
              取消
            </button>
          </div>
        )}
      </Show>
      <Show when={selected()}>
        {(card) => (
          <Show
            when={
              !locked(card()) &&
              (!boardFailed(current(card())) ||
                state.historyCoverIDs.includes(card().id) ||
                state.suppressedFailureIDs.includes(card().currentGenerationID ?? "")) &&
              boardMedia(card(), state.results).length > 0
            }
          >
            <StudioBoardMediaToolbar
              kind={card().kind}
              anchor={state.mediaToolbarAnchor}
              hidden={state.draggingCard}
              onDownload={() => void downloadMedia(card())}
              regenerateBlocked={busy() || editingBlocked(card()) || !!state.saveError}
              onRegenerate={() => regenerate(card())}
              videoActive={state.video?.cardID === card().id}
              videoBlocked={!!props.demo || busy() || editingBlocked(card()) || !!state.saveError || studioPermissionState.status !== "ready" || !studioPermissionState.video}
              onVideo={toggleVideo}
              upscaleActive={state.upscaleCardID === card().id}
              upscaleBlocked={editingBlocked(card())}
              onUpscale={toggleUpscale}
              cutoutActive={state.cutoutCardID === card().id}
              cutoutBlocked={busy() || editingBlocked(card()) || !!state.saveError}
              onCutout={() => generateDerived("image.cutout")}
              inpaintActive={state.inpaint?.cardID === card().id}
              inpaintBlocked={busy() || editingBlocked(card()) || !!state.saveError}
              onInpaint={toggleInpaint}
              outpaintActive={state.outpaint?.cardID === card().id}
              outpaintBlocked={busy() || editingBlocked(card()) || !!state.saveError}
              onOutpaint={toggleOutpaint}
            />
          </Show>
        )}
      </Show>
      <Show when={selected() && state.upscaleCardID === selected()!.id}>
        <StudioBoardUpscale
          anchor={state.anchor}
          mode={state.upscaleMode}
          hidden={state.draggingCard}
          blocked={busy() || awaitingRecovery() || !!state.saveError}
          preparing={state.derivedPreparing}
          onMode={(mode) => setState("upscaleMode", mode)}
          onGenerate={() => generateDerived("image.upscale")}
        />
      </Show>
      <Show when={selected() && state.inpaint?.cardID === selected()!.id}>
        <StudioBoardInpaint anchor={state.inpaintAnchor} drawing={inpaintDrawing}
          mode={state.inpaintMode} brushSize={state.inpaintBrush} prompt={state.inpaintPrompt}
          hidden={state.draggingCard} blocked={busy() || awaitingRecovery() || !!state.saveError}
          preparing={state.derivedPreparing} error={state.inpaintError}
          onMode={(mode) => setState("inpaintMode", mode)} onBrush={(size) => setState("inpaintBrush", size)}
          onPrompt={(prompt) => setState("inpaintPrompt", prompt)} onCancel={() => setState("inpaint", undefined)}
          onGenerate={generateInpaint} />
      </Show>
      <Show when={state.video} keyed>
        {(video) => <StudioBoardVideo source={video.source} anchor={state.anchor} hidden={state.draggingCard}
          blocked={busy() || awaitingRecovery() || !!state.saveError || state.exiting}
          canGenerate={studioPermissionState.status === "ready" && studioPermissionState.video}
          bounds={() => board} mediaURL={mediaURL} onUpload={uploadVideoFiles} onGenerate={generateVideo}
          onError={notify} onRetryPermission={props.onRetryPermission} />}
      </Show>
      {/* Keep card identity stable while popup cleanup commits its local inputs. */}
      <Show when={selected() && state.outpaint?.cardID === selected()!.id}>
        <StudioBoardOutpaint anchor={state.outpaintAnchor} editor={outpaintEditor} prompt={state.outpaintPrompt}
          hidden={state.draggingCard} blocked={busy() || awaitingRecovery() || !!state.saveError}
          preparing={state.derivedPreparing} error={state.outpaintError}
          onPrompt={(prompt) => setState("outpaintPrompt", prompt)} onCancel={() => setState("outpaint", undefined)}
          onGenerate={generateOutpaint} />
      </Show>
      <Show when={selected() && !selected()!.operation && state.upscaleCardID !== selected()!.id && state.cutoutCardID !== selected()!.id && state.inpaint?.cardID !== selected()!.id && state.outpaint?.cardID !== selected()!.id && state.video?.cardID !== selected()!.id ? selected() : undefined} keyed>
        {(card) => (
          <StudioBoardComposer
            card={card}
            document={state.document}
            references={references()}
            anchor={state.anchor}
            hidden={state.draggingCard}
            blocked={editingBlocked(card)}
            canGenerate={
              !!card.draft.prompt.trim() && !busy() && state.ready && !awaitingRecovery() && !state.saveError
            }
            menusBlocked={awaitingRecovery()}
            menuTab={state.menuTab}
            showMentionEntry={showMentionEntry()}
            demo={props.demo}
            mediaURL={mediaURL}
            elements={{
              composer: (element) => {
                composer = element
                updateAnchor()
              },
              uploadInput: (element) => {
                uploadInput = element
              },
              dropdown: (element) => {
                dropdown = element
              },
              menuButton: (tab, element) => menuButtons.set(tab, element),
            }}
            onUpload={(files) => void upload(files)}
            onDropUpload={(files, role) => {
              uploadRole = role
              uploadCardID = card.id
              void upload(files)
            }}
            onPickUpload={pickUpload}
            onSwapFrames={() => swapVideoFrames(card)}
            onRemoveReference={(reference) => {
              if (editingBlocked(card)) return
              const edge = state.document.draftEdges.find(
                (item) =>
                  item.targetID === card.id && item.sourceID === reference.sourceID && boardEdgeRole(card.kind, card.draft.settings, item) === reference.role,
              )
              if (edge) removeEdge(edge.id)
              setState("document", "cards", (item) => item.id === card.id, "draft", "references",
                (items) => items?.filter((item) => item.sourceID !== reference.sourceID ||
                  item.generationID !== reference.generationID || item.mediaID !== reference.mediaID ||
                  boardEdgeRole(card.kind, card.draft.settings, { role: item.role, reference: item }) !== reference.role))
              if (reference.sourceID.startsWith("upload:"))
                setState(
                  "document",
                  "cards",
                  (item) => item.id === card.id,
                  "draft",
                  "assets",
                  (assets) => assets.filter((asset) => asset.id !== reference.mediaID),
                )
            }}
            onPrompt={(value) => {
              if (!editingBlocked(card))
                setState("document", "cards", (item) => item.id === card.id, "draft", "prompt", value)
            }}
            onMenuTab={(tab) => setState("menuTab", tab)}
            onStyleModel={(value) => {
              if (editingBlocked(card)) return
              setState(
                "document",
                "cards",
                (item) => item.id === card.id,
                "draft",
                "settings",
                reconcileStore(normalizeBoardSettings({ ...card.draft.settings, styleModel: value })),
              )
              setState("menuTab", "")
            }}
            onSetting={(key, value) => draftSetting(card.id, key, value)}
            onMention={(index) => {
              if (editingBlocked(card)) return
              setState(
                "document",
                "cards",
                (item) => item.id === card.id,
                "draft",
                "prompt",
                (text) => `${text}${text ? " " : ""}@参考图${index + 1} `,
              )
              setState("menuTab", "")
            }}
            onGenerate={() => void generate()}
            onRetryPermission={props.onRetryPermission}
          />
        )}
      </Show>
      <Show when={state.resultsCardID}>
        {(id) => {
          const card = () => state.document.cards.find((item) => item.id === id())
          return (
            <Show when={card()}>
              {(item) => (
                <StudioBoardResults
                  card={item()}
                  cards={state.document.cards}
                  results={state.results}
                  inspectGenerationID={state.inspectGenerationID}
                  suppressedFailureIDs={state.suppressedFailureIDs}
                  blocked={awaitingRecovery()}
                  mediaURL={mediaURL}
                  onClose={() => setState("resultsCardID", "")}
                  onInspect={(generationID) => setState("inspectGenerationID", generationID)}
                  onPreview={(media) => {
                    board.querySelectorAll("video").forEach((video) => video.pause())
                    setState("fullscreenMedia", media)
                  }}
                  onCover={(cover) => {
                    if (awaitingRecovery()) return
                    setState("historyCoverIDs", (ids) => [...ids.filter((id) => id !== item().id), item().id])
                    editCard(item().id, { cover, preview: cover })
                  }}
                />
              )}
            </Show>
          )
        }}
      </Show>
      <Show when={state.fullscreenMedia} keyed>
        {(media) => (
          <Show
            when={media.kind === "video"}
            fallback={
              <StudioFullscreenImage
                src={mediaURL(originalMediaSrc(media)) ?? ""}
                mount={() => board}
                onClose={() => setState("fullscreenMedia", undefined)}
              />
            }
          >
            <StudioVideoPlayer
              src={mediaURL(originalMediaSrc(media)) ?? ""}
              poster={mediaURL(media.thumbnailUrl)}
              mount={() => board}
              inline
              initialFullscreen
              onExitFullscreen={() => setState("fullscreenMedia", undefined)}
            />
          </Show>
        )}
      </Show>
      <Show when={state.marquee}>
        {(rect) => (
          <div
            class="studio-board-marquee"
            style={{
              left: `${rect().x}px`,
              top: `${rect().y}px`,
              width: `${rect().width}px`,
              height: `${rect().height}px`,
            }}
          />
        )}
      </Show>
      <Show when={state.guides.x !== undefined}>
        <div class="studio-board-guide vertical" style={{ left: `${state.guides.x}px` }} />
      </Show>
      <Show when={state.guides.y !== undefined}>
        <div class="studio-board-guide horizontal" style={{ top: `${state.guides.y}px` }} />
      </Show>
      <Show when={state.notice}>
        <div class="studio-board-notice" role="status">
          {state.notice}
        </div>
      </Show>
      <footer class="studio-board-footer">
        <span class="studio-board-help">V 选择 · H 平移 · 拖动空白框选 · 滚轮缩放 · ⌘ / Ctrl 多选 · 悬停连线后单击剪断</span>
        <div class="studio-board-zoom">
          <button
            type="button"
            aria-label="缩小画布"
            onClick={() => graph?.zoomTo(Math.max(BOARD_MIN_ZOOM, state.zoom - 0.1))}
          >
            −
          </button>
          <button type="button" onClick={() => graph?.zoomTo(1)}>
            {Math.round(state.zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大画布"
            onClick={() => graph?.zoomTo(Math.min(BOARD_MAX_ZOOM, state.zoom + 0.1))}
          >
            ＋
          </button>
          <button
            type="button"
            aria-label="适应全部卡片"
            onClick={() =>
              graph?.zoomToFit({
                padding: { top: 100, right: 80, bottom: 260, left: 80 },
                minScale: BOARD_MIN_ZOOM,
                maxScale: 1,
              })
            }
          >
            适应
          </button>
        </div>
      </footer>
    </div>
  )
}
