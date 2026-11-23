import { Graph, Shape, type Edge, type Node } from "@antv/x6"
import { batch, createEffect, createMemo, getOwner, onCleanup, onMount, runWithOwner, Show } from "solid-js"
import { createStore, reconcile as reconcileStore } from "solid-js/store"
import { render } from "solid-js/web"
import {
  type BoardSettings,
  BoardSnapshot,
  boardFrameSourceCount,
  boardGenerationError,
  recoverBoardDraft,
  type BoardSubmission,
} from "@opencode-ai/core/studio-board"
import { studioPermissionState } from "../studio-permission-store"
import { createBoardOperations } from "./studio-board-operations"
import { isSeedreamStyleModel, referenceImageLimit, styleModelId } from "../data"
import { resolveStudioMediaUrl } from "../studio-media"
import type { StudioGenerationResult } from "../types"
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
  boardReferences,
  boardConnectionError,
  boardWheelZoom,
  boardDocumentJSON,
  boardDocumentSnapshot,
  boardCanGenerate,
  normalizeBoardSettings,
  normalizeBoardDraft,
  emptyBoard,
  newBoardCard,
  type BoardCard,
  type BoardResults,
} from "./studio-board-state"
import { StudioBoardCardView } from "./studio-board-card"
import { StudioBoardComposer } from "./studio-board-composer"
import { StudioBoardResults } from "./studio-board-results"
import "./studio-board.css"

const WIDTH = 280
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
    menuTab: "",
    zoom: 1,
    menu: undefined as
      | { x: number; y: number; point: { x: number; y: number }; sourceID?: string; previewID?: string }
      | undefined,
    anchor: { left: 0, top: 0, width: 440 },
    marquee: undefined as { x: number; y: number; width: number; height: number } | undefined,
    historyPreviewIDs: [] as string[],
    suppressedFailureIDs: [] as string[],
    guides: {} as { x?: number; y?: number },
  })
  const documentJSON = createMemo(() => boardDocumentJSON(state.document))
  const dirty = () => documentJSON() !== state.savedDocumentJSON
  const operations = createBoardOperations()
  const roots = new Map<string, () => void>()
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
  const editingBlocked = (card: BoardCard) => state.exiting || awaitingRecovery() || locked(card)
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
  let stopFlow = () => {}
  let temporaryEdge: Edge | undefined
  let selectionStart: { x: number; y: number } | undefined
  let snapping = false

  function notify(message: string) {
    clearTimeout(noticeTimer)
    setState("notice", message)
    noticeTimer = setTimeout(() => setState("notice", ""), 3500)
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
      const width = Math.min(440, bounds.width - 32)
      setState("anchor", {
        left: point.x - bounds.left - width / 2,
        top: point.y - bounds.top + 16,
        width,
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
  function closeMenu() {
    if (temporaryEdge) graph?.removeCell(temporaryEdge)
    temporaryEdge = undefined
    setState("menu", undefined)
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
    setState("document", "draftEdges", (edges) => [...edges, { id: connection.id, sourceID, targetID, role }])
    if (role !== "reference") draftSetting(targetID, "videoMode", "first_last_frame")
    select(targetID)
    return true
  }
  function addCard(kind: BoardCard["kind"] = "image", fromMenu = false) {
    if (!graph || !state.ready || awaitingRecovery()) return
    const menu = fromMenu ? state.menu : undefined
    const bounds = board.getBoundingClientRect()
    const center =
      menu?.point ?? graph.clientToLocal(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2 - 50)
    const origin = { x: center.x - (menu?.sourceID ? -20 : WIDTH / 2), y: center.y - HEIGHT / 2 }
    const point = Array.from({ length: state.document.cards.length + 1 }, (_, index) => ({
      x: origin.x,
      y: origin.y + index * (HEIGHT + 40),
    })).find((item) =>
      state.document.cards.every(
        (card) =>
          item.x + WIDTH + 40 < card.position.x ||
          item.x > card.position.x + WIDTH + 40 ||
          item.y + HEIGHT + 24 < card.position.y ||
          item.y > card.position.y + HEIGHT + 24,
      ),
    )!
    const card = newBoardCard(crypto.randomUUID(), kind, point)
    card.title = `${kind === "image" ? "图片" : "视频"} ${String(state.document.cards.filter((item) => item.kind === kind).length + 1).padStart(2, "0")}`
    if (kind === "image" && !props.demo && studioPermissionState.status === "ready" && !studioPermissionState.seedream)
      card.draft.settings.styleModel = "qwen"
    setState("document", "cards", (cards) => [...cards, card])
    mountCard(card)
    if (menu?.sourceID && !connect(menu.sourceID, card.id, kind === "video" ? "firstFrame" : "reference")) {
      removeCard(card.id)
      closeMenu()
      return
    }
    closeMenu()
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
    graph?.removeCell(id)
    setState("document", "draftEdges", (edges) => edges.filter((item) => item.id !== id))
  }
  function removeCard(id: string) {
    if (awaitingRecovery()) return
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
          opacity: boardCover(card, state.results) ? 1 : 0.35,
        })
      node
        .getPorts()
        .filter((port) => port.id !== "output")
        .forEach((port) => {
          const blocked =
            editingBlocked(card) ||
            (port.id !== "reference" && !!boardFrameSourceCount(state.document, card.id, port.id!))
          node.portProp(port.id!, "attrs/circle", {
            magnet: blocked ? false : "passive",
            opacity: blocked ? 0.35 : 1,
          })
        })
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
                  historyPreview={state.historyPreviewIDs.includes(id)}
                  failureSuppressed={state.suppressedFailureIDs.includes(value().currentGenerationID ?? "")}
                  rebootBlocked={busy() || awaitingRecovery()}
                  mediaURL={mediaURL}
                  onOperate={(action) => void operate(id, action)}
                  onRefresh={() => void reconcile(id)}
                  onRemove={() => removeCard(id)}
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
    const port = (position: "left" | "right", y?: number) => ({
      position: { name: position, args: { dx: position === "left" ? -18 : 18, ...(y === undefined ? {} : { y }) } },
      markup: [
        { tagName: "circle", selector: "circle" },
        { tagName: "path", selector: "plus" },
      ],
      attrs: {
        circle: {
          r: 10,
          magnet: position === "left" ? "passive" : false,
          stroke: "#858ac0",
          strokeWidth: 1.5,
          fill: "#fff",
        },
        plus: { d: "M -4 0 L 4 0 M 0 -4 L 0 4", stroke: "#7479ae", strokeWidth: 1.4, pointerEvents: "none" },
      },
    })
    graph.addNode({
      id,
      shape: "studio-board-card",
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
        source: { cell: edge.sourceID, port: "output" },
        target: { cell: edge.targetID, port: edge.role },
      }),
    )
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
      setState("historyPreviewIDs", (ids) => ids.filter((id) => cards.has(id)))
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
        if (first && card.currentGenerationID === result.id && card.preview?.generationID !== result.id)
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
    if (role !== "reference" && (files.length > 1 || boardFrameSourceCount(state.document, card.id, role))) {
      notify("该帧已有引用，请先移除后替换")
      return
    }
    if (files.length + refs.length > referenceImageLimit(card.draft.settings.styleModel)) {
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
              (items) => [...items, ...assets],
            )
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
  async function generate() {
    // ImageSettings commits its local size inputs when the popup is disposed.
    setState("menuTab", "")
    await Promise.resolve()
    const card = selected()
    if (
      disposed ||
      state.exiting ||
      !card ||
      busy() ||
      !state.ready ||
      awaitingRecovery() ||
      state.saveError ||
      !card.draft.prompt.trim()
    )
      return
    const settings = card.draft.settings
    if (!props.demo && !boardCanGenerate(card, studioPermissionState)) {
      notify("请先加载模型权限或选择有权限的模型")
      return
    }
    const refs = references()
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
        .filter((edge) => edge.targetID === card.id)
        .some((edge) => {
          const source = state.document.cards.find((item) => item.id === edge.sourceID)
          return !source || !boardCover(source, state.results)
        })
    ) {
      notify("参考图不可用，请重新选择封面")
      return
    }
    const snapshot = BoardSnapshot.parse({ prompt: card.draft.prompt.trim(), settings, references: refs })
    setState("historyPreviewIDs", (ids) => ids.filter((id) => id !== card.id))
    if (props.demo) {
      simulate(card.id, snapshot)
      return
    }
    operations.start(card.id, "creating")
    const replacedGenerationID = boardFailed(current(card)) ? card.currentGenerationID : undefined
    if (replacedGenerationID) setState("suppressedFailureIDs", (ids) => [...new Set([...ids, replacedGenerationID])])
    await enqueueWrite(async () => {
      await persistBoard()
      if (disposed) return
      if (!state.sessionID) throw new Error("无法创建画布会话")
      await submit({
        sessionID: state.sessionID,
        capability: card.kind === "image" ? "image.generate" : "video.generate",
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
    }).catch((error: unknown) => {
      operations.finish(card.id)
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
      capability: "image.generate",
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
    setState("historyPreviewIDs", (ids) => ids.filter((id) => id !== cardID))
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
    edge.attr("line/stroke", "#7775e7")
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stopFlow = () => edge.attr("line/stroke", "#a7abc4")
      return
    }
    const view = graph?.findViewByCell(edge)
    const path = view?.container.querySelector<SVGPathElement>("path[data-selector=line], path.connection")
    if (!view || !path) return
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
      edge.attr("line/stroke", "#a7abc4")
    }
  }
  onMount(() => {
    graph = new Graph({
      container: canvas,
      autoResize: true,
      background: { color: "#f7f8fb" },
      grid: { visible: true, size: 24, type: "dot", args: { color: "#d6d9e2", thickness: 1 } },
      panning: { enabled: true, eventTypes: ["leftMouseDown", "mouseWheelDown"] },
      mousewheel: { enabled: false },
      interacting: () => ({
        edgeMovable: false,
        arrowheadMovable: false,
        nodeMovable: !awaitingRecovery(),
        magnetConnectable: !awaitingRecovery(),
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
      if (!e.ctrlKey && !e.metaKey) select(node.id)
    })
    graph.on("node:click", ({ node, e }) => select(node.id, e.ctrlKey || e.metaKey))
    graph.on("blank:click", () => {
      if (state.marquee) return
      select("")
      closeMenu()
    })
    graph.on("blank:contextmenu", ({ e }) => {
      e.preventDefault()
      closeMenu()
      openMenu(e.clientX, e.clientY)
    })
    const clearGuides = () => setState("guides", { x: undefined, y: undefined })
    graph.on("node:moving", ({ node }) => {
      if (snapping) return
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
      clearGuides()
    })
    const viewport = () => {
      closeMenu()
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
    graph.on("edge:dblclick", ({ edge }) => removeEdge(edge.id))
    graph.on("edge:mouseenter", ({ edge }) => flow(edge))
    graph.on("edge:mouseleave", () => stopFlow())
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 0.1 || state.menu) return
      event.preventDefault()
      wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientHeight : 1)
      wheelPoint = { x: event.clientX, y: event.clientY }
      if (wheelFrame) return
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0
        const next = boardWheelZoom(graph!.zoom(), wheelDelta, 0, board.clientHeight)
        const center = graph!.clientToLocal(wheelPoint.x, wheelPoint.y)
        graph!.zoomTo(next, { center })
        wheelDelta = 0
      })
    }
    canvas.addEventListener("wheel", wheel, { passive: false })
    const down = (event: PointerEvent) => {
      if (event.target instanceof Element && !composer?.contains(event.target)) setState("menuTab", "")
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, input, textarea, video, [contenteditable], .studio-board-create-menu, .studio-board-results",
        )
      )
        return
      closeMenu()
      if (!event.shiftKey || !(event.target instanceof Element) || event.target.closest(".x6-node")) return
      event.preventDefault()
      event.stopPropagation()
      graph?.disablePanning()
      const bounds = board.getBoundingClientRect()
      selectionStart = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }
    const move = (event: PointerEvent) => {
      if (!selectionStart) return
      const bounds = board.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      setState("marquee", {
        x: Math.min(selectionStart.x, x),
        y: Math.min(selectionStart.y, y),
        width: Math.abs(x - selectionStart.x),
        height: Math.abs(y - selectionStart.y),
      })
    }
    const up = () => {
      clearGuides()
      if (!selectionStart) return
      const rect = state.marquee
      const bounds = board.getBoundingClientRect()
      if (rect)
        setState(
          "selectedIDs",
          graph!
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
        )
      selectionStart = undefined
      graph?.enablePanning()
      setTimeout(() => setState("marquee", undefined), 0)
      updateAnchor()
    }
    board.addEventListener("pointerdown", down, true)
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", clearGuides)
    window.addEventListener("blur", clearGuides)
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
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      document.removeEventListener("pointercancel", clearGuides)
      window.removeEventListener("blur", clearGuides)
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
          card.draft.assets.length || state.document.draftEdges.some((edge) => edge.targetID === card.id)
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

  return (
    <div
      ref={board}
      inert={state.exiting}
      class="studio-board"
      tabindex={-1}
      aria-label="Studio 画布"
      onKeyDown={(event) => {
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
          closeMenu()
          setState("resultsCardID", "")
          select("")
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault()
          ;[...state.selectedIDs].forEach(removeCard)
        }
      }}
    >
      <div ref={canvas} class="studio-board-graph" />
      <header class="studio-board-header">
        <div class="studio-board-header-left">
          <button
            type="button"
            class="studio-board-exit"
            disabled={state.exiting}
            onClick={() => {
              if (state.exiting) return
              if (awaitingRecovery()) {
                props.onExit()
                return
              }
              if (props.demo || (!state.sessionID && !state.document.cards.length)) {
                if (!props.demo) localStorage.removeItem(backupKey())
                props.onExit()
                return
              }
              setState("menuTab", "")
              setState("exiting", true)
              clearTimeout(saveTimer)
              void enqueueWrite(async () => {
                if (disposed) return
                // Uncertain operations cannot change the revision until reconciled,
                // but their original IDs and unsaved drafts can safely survive exit.
                if (pending.size || reboots.size) {
                  if ((await writeBackup()) && !disposed) props.onExit()
                  return
                }
                await persistBoard(true)
                if (!disposed) props.onExit()
              })
                .catch(() => notify("保存失败，请重试保存后退出"))
                .finally(() => {
                  if (!disposed) setState("exiting", false)
                })
            }}
          >
            ← 退出画布
          </button>
          <span class="studio-board-header-divider" />
          <span class="studio-board-name">{props.demo ? "演示画布" : "灵感画布"}</span>
          <Show when={props.demo}>
            <span class="studio-board-badge">DEMO</span>
          </Show>
        </div>
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
      <div class="studio-board-tools">
        <button type="button" aria-label="新建图片卡片" disabled={awaitingRecovery()} onClick={() => addCard()}>
          ＋
        </button>
        <Show when={!props.demo && studioPermissionState.video}>
          <button
            type="button"
            aria-label="新建视频卡片"
            disabled={awaitingRecovery()}
            onClick={() => addCard("video")}
          >
            ▷
          </button>
        </Show>
      </div>
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
      {/* Keep card identity stable while popup cleanup commits its local inputs. */}
      <Show when={selected()} keyed>
        {(card) => (
          <StudioBoardComposer
            card={card}
            document={state.document}
            references={references()}
            anchor={state.anchor}
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
            onPickUpload={pickUpload}
            onRemoveReference={(reference) => {
              if (editingBlocked(card)) return
              const edge = state.document.draftEdges.find(
                (item) =>
                  item.targetID === card.id && item.sourceID === reference.sourceID && item.role === reference.role,
              )
              if (edge) removeEdge(edge.id)
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
                  onPreview={(preview) => {
                    if (awaitingRecovery()) return
                    setState("historyPreviewIDs", (ids) => [...ids.filter((id) => id !== item().id), item().id])
                    editCard(item().id, { preview, currentGenerationID: item().currentGenerationID })
                  }}
                  onCover={(cover) => editCard(item().id, { cover })}
                />
              )}
            </Show>
          )
        }}
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
        <span class="studio-board-help">拖动平移 · 滚轮缩放 · Shift 拖动框选 · ⌘ / Ctrl 多选 · 双击连线移除</span>
        <div class="studio-board-zoom">
          <button type="button" aria-label="缩小画布" onClick={() => graph?.zoomTo(Math.max(0.35, state.zoom - 0.1))}>
            −
          </button>
          <button type="button" onClick={() => graph?.zoomTo(1)}>
            {Math.round(state.zoom * 100)}%
          </button>
          <button type="button" aria-label="放大画布" onClick={() => graph?.zoomTo(Math.min(1.8, state.zoom + 0.1))}>
            ＋
          </button>
          <button
            type="button"
            aria-label="适应全部卡片"
            onClick={() =>
              graph?.zoomToFit({ padding: { top: 100, right: 80, bottom: 260, left: 80 }, minScale: 0.35, maxScale: 1 })
            }
          >
            适应
          </button>
        </div>
      </footer>
    </div>
  )
}
