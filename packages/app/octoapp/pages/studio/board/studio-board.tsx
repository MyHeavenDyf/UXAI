import { Graph, Shape, type Node } from "@antv/x6"
import { createMemo, For, getOwner, onCleanup, onMount, runWithOwner, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { boardConnectionError, boardReferences, type BoardCard, type BoardEdge } from "./studio-board-state"
import "./studio-board.css"

const CARD_WIDTH = 272
const CARD_HEIGHT = 312
const hosts = new Map<string, HTMLElement>()
const samples = ["landscape", "still-life", "architecture"].map((name) => `/studio/board-demo/${name}.svg`)
const edgeStyle = {
  zIndex: 0,
  router: { name: "manhattan", args: { padding: 24 } },
  connector: { name: "rounded", args: { radius: 16 } },
  attrs: { line: { stroke: "#a59af3", strokeWidth: 2, targetMarker: { name: "classic", size: 6 } } },
}

Shape.HTML.register({
  shape: "studio-board-image",
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  effect: [],
  html: (cell) => hosts.get(cell.id) ?? document.createElement("div"),
})

function BoardIcon(props: { name: "image" | "plus" | "back" | "close" | "fit" | "minus" | "trash" | "arrow" }) {
  const paths = {
    image: "M4 3h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 13l4-4 4 4 3-3 3 3M13 6h.01",
    plus: "M10 4v12M4 10h12",
    back: "m11 4-6 6 6 6M5 10h12",
    close: "m5 5 10 10M15 5 5 15",
    fit: "M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4",
    minus: "M4 10h12",
    trash: "M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6m4-6v6",
    arrow: "M10 16V4m-5 5 5-5 5 5",
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[props.name]} />
    </svg>
  )
}

export default function StudioBoard(props: { onExit: () => void }) {
  const owner = getOwner()
  const [state, setState] = createStore({
    cards: [] as BoardCard[],
    edges: [] as BoardEdge[],
    selectedID: "",
    zoom: 1,
    notice: "",
    anchor: { left: 0, top: 0, width: 400 },
  })
  const selected = createMemo(() => state.cards.find((card) => card.id === state.selectedID))
  const references = createMemo(() => boardReferences(state.cards, state.edges, state.selectedID))
  const roots = new Map<string, () => void>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  let graph: Graph | undefined
  let board!: HTMLDivElement
  let canvas!: HTMLDivElement
  let composer: HTMLDivElement | undefined
  let frame = 0
  let sequence = 0
  let noticeTimer: ReturnType<typeof setTimeout> | undefined

  function notify(message: string) {
    clearTimeout(noticeTimer)
    setState("notice", message)
    noticeTimer = setTimeout(() => setState("notice", ""), 2800)
  }

  function updateAnchor() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!graph) return
      setState("zoom", graph.zoom())
      const node = graph.getCellById(state.selectedID)
      if (!node?.isNode()) return
      const bounds = board.getBoundingClientRect()
      const point = graph.localToClient(node.getBBox().bottomCenter)
      const width = Math.min(400, Math.max(0, bounds.width - 32))
      setState("anchor", {
        left: Math.max(16, Math.min(bounds.width - width - 16, point.x - bounds.left - width / 2)),
        top: Math.max(76, Math.min(bounds.height - (composer?.offsetHeight ?? 180) - 64, point.y - bounds.top + 16)),
        width,
      })
    })
  }

  function select(id: string) {
    setState("selectedID", id)
    updateAnchor()
  }

  function removeEdge(id: string) {
    const edge = state.edges.find((item) => item.id === id)
    if (!edge) return
    if (state.cards.find((card) => card.id === edge.targetID)?.status !== "draft") {
      notify("已生成任务的参考关系保持不变")
      return
    }
    graph?.removeCell(id)
    setState("edges", (edges) => edges.filter((item) => item.id !== id))
    updateAnchor()
  }

  function removeCard(id: string) {
    if (state.cards.find((card) => card.id === id)?.status === "running") {
      notify("请等待模拟生成完成")
      return
    }
    if (state.selectedID === id) select("")
    graph?.removeCell(id)
    roots.get(id)?.()
    roots.delete(id)
    hosts.delete(id)
    setState("edges", (edges) => edges.filter((edge) => edge.sourceID !== id && edge.targetID !== id))
    setState("cards", (cards) => cards.filter((card) => card.id !== id))
  }

  function addCard(position?: { x: number; y: number }, prompt = "", inputs?: BoardCard["inputs"]) {
    if (!graph) return
    const id = crypto.randomUUID()
    const previous = graph.getCellById(state.selectedID)
    const center = graph.clientToLocal(
      board.getBoundingClientRect().left + board.clientWidth / 2,
      board.getBoundingClientRect().top + Math.max(220, (board.clientHeight - 170) / 2),
    )
    const origin = position ?? {
      x: previous?.isNode() ? previous.position().x + CARD_WIDTH + 96 : center.x - CARD_WIDTH / 2,
      y: previous?.isNode() ? previous.position().y : center.y - CARD_HEIGHT / 2,
    }
    const occupied = graph.getNodes().map((node) => node.getBBox())
    const placement = Array.from({ length: occupied.length + 1 }, (_, index) => ({
      x: origin.x,
      y: origin.y + index * (CARD_HEIGHT + 64),
    })).find((point) =>
      occupied.every(
        (rect) =>
          point.x + CARD_WIDTH + 32 <= rect.x ||
          rect.x + rect.width + 32 <= point.x ||
          point.y + CARD_HEIGHT + 32 <= rect.y ||
          rect.y + rect.height + 32 <= point.y,
      ),
    )!
    setState("cards", (cards) => [
      ...cards,
      { id, title: `图片 ${String(++sequence).padStart(2, "0")}`, prompt, status: "draft", progress: 0, inputs },
    ])
    const host = document.createElement("div")
    hosts.set(id, host)
    roots.set(
      id,
      runWithOwner(owner, () =>
        render(() => {
          const card = () => state.cards.find((item) => item.id === id)!
          return (
            <article
              class="studio-board-card"
              classList={{ selected: state.selectedID === id }}
              aria-label={card().title}
            >
              <header>
                <span class="studio-board-card-title">
                  <BoardIcon name="image" />
                  {card().title}
                </span>
                <span class="studio-board-card-status" classList={{ complete: card().status === "succeeded" }}>
                  {card().status === "draft" ? "草稿" : card().status === "running" ? "生成中" : "已完成"}
                </span>
                <button
                  type="button"
                  class="studio-board-card-delete"
                  aria-label={`移除${card().title}`}
                  disabled={card().status === "running"}
                  on:mousedown={(event) => event.stopPropagation()}
                  on:pointerdown={(event) => event.stopPropagation()}
                  on:click={(event) => {
                    event.stopPropagation()
                    removeCard(id)
                  }}
                >
                  <BoardIcon name="trash" />
                </button>
              </header>
              <div class="studio-board-card-media">
                <Show
                  when={card().image}
                  fallback={
                    <div class="studio-board-card-placeholder">
                      <Show
                        when={card().status === "running"}
                        fallback={
                          <>
                            <BoardIcon name="image" />
                            <span>让想法成为画面</span>
                            <small>选中卡片，输入你的创意</small>
                          </>
                        }
                      >
                        <span class="studio-board-spinner" />
                        <span>正在模拟生成 {card().progress}%</span>
                        <div class="studio-board-progress">
                          <i style={{ width: `${card().progress}%` }} />
                        </div>
                      </Show>
                    </div>
                  }
                >
                  <img src={card().image} alt={`${card().title}的模拟生成示例`} draggable={false} />
                  <span class="studio-board-sample-label">示例图片</span>
                </Show>
              </div>
            </article>
          )
        }, host),
      )!,
    )
    const node = graph.addNode({
      id,
      shape: "studio-board-image",
      zIndex: 1,
      x: placement.x,
      y: placement.y,
      ports: {
        groups: {
          input: {
            position: "left",
            attrs: { circle: { r: 6, magnet: "passive", stroke: "#767b86", strokeWidth: 2, fill: "#24262b" } },
          },
          output: {
            position: "right",
            attrs: {
              circle: { r: 6, magnet: false, stroke: "#767b86", strokeWidth: 2, fill: "#24262b", opacity: 0.35 },
            },
          },
        },
        items: [
          { id: "input", group: "input" },
          { id: "output", group: "output" },
        ],
      },
    })
    if (state.cards.length > 1)
      graph.zoomToFit({ padding: { top: 100, right: 80, bottom: 240, left: 100 }, minScale: 0.35, maxScale: 1 })
    select(id)
    return node
  }

  function generate() {
    const current = selected()
    if (!current?.prompt.trim() || current.status === "running" || !graph) return
    const inputs = references().map((reference) => ({ ...reference }))
    const original = graph.getCellById(current.id) as Node
    const node =
      current.status === "succeeded"
        ? addCard({ x: original.position().x + CARD_WIDTH + 96, y: original.position().y }, current.prompt, inputs)
        : original
    if (!node) return
    if (current.status === "succeeded") {
      state.edges
        .filter((edge) => edge.targetID === current.id)
        .forEach((edge) => {
          if (!graph?.getCellById(edge.sourceID)) return
          const copy = graph.addEdge({
            ...edgeStyle,
            source: { cell: edge.sourceID, port: "output" },
            target: { cell: node.id, port: "input" },
          })
          setState("edges", (edges) => [...edges, { id: copy.id, sourceID: edge.sourceID, targetID: node.id }])
        })
    }
    const image = samples[(sequence - 1) % samples.length]
    setState("cards", (card) => card.id === node.id, { status: "running", progress: 0, inputs })
    node.portProp("input", "attrs/circle/opacity", 0.35)
    const timer = setInterval(() => {
      const card = state.cards.find((item) => item.id === node.id)
      if (!card) {
        clearInterval(timer)
        timers.delete(timer)
        return
      }
      const progress = Math.min(100, card.progress + 10)
      setState("cards", (item) => item.id === node.id, "progress", progress)
      if (progress < 100) return
      clearInterval(timer)
      timers.delete(timer)
      setState("cards", (item) => item.id === node.id, { status: "succeeded", image })
      node.portProp("output", "attrs/circle", { magnet: true, stroke: "#b5a5ff", fill: "#b5a5ff", opacity: 1 })
    }, 180)
    timers.add(timer)
  }

  onMount(() => {
    graph = new Graph({
      container: canvas,
      autoResize: true,
      background: { color: "#17181b" },
      grid: { visible: true, size: 24, type: "dot", args: { color: "#45474f", thickness: 1 } },
      panning: { enabled: true, eventTypes: ["leftMouseDown", "mouseWheelDown"] },
      mousewheel: { enabled: true, minScale: 0.35, maxScale: 1.8, zoomAtMousePosition: true },
      interacting: { edgeMovable: false, arrowheadMovable: false },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowMulti: false,
        snap: { radius: 24 },
        connector: edgeStyle.connector,
        highlight: true,
        createEdge: () => new Shape.Edge(edgeStyle),
        validateMagnet: ({ cell, magnet }) =>
          magnet.getAttribute("port") === "output" &&
          state.cards.some((card) => card.id === cell.id && card.status === "succeeded"),
        validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort }) => {
          if (!sourceCell || !targetCell || sourcePort !== "output" || targetPort !== "input") return false
          return !boardConnectionError(state.cards, state.edges, sourceCell.id, targetCell.id)
        },
      },
    })
    graph.on("node:click", ({ node }) => select(node.id))
    graph.on("node:mousedown", ({ node }) => {
      board.focus({ preventScroll: true })
      select(node.id)
    })
    graph.on("blank:mousedown", () => board.focus({ preventScroll: true }))
    graph.on("blank:click", () => select(""))
    graph.on("node:moving", updateAnchor)
    graph.on("scale", updateAnchor)
    graph.on("translate", updateAnchor)
    graph.on("resize", updateAnchor)
    graph.on("edge:connected", ({ edge }) => {
      const sourceID = edge.getSourceCellId()
      const targetID = edge.getTargetCellId()
      const error = boardConnectionError(state.cards, state.edges, sourceID, targetID)
      if (error) {
        graph?.removeCell(edge)
        notify(error)
        return
      }
      setState("edges", (edges) => [...edges, { id: edge.id, sourceID, targetID }])
      select(targetID)
    })
    graph.on("edge:dblclick", ({ edge }) => removeEdge(edge.id))
    const observer = new ResizeObserver(updateAnchor)
    observer.observe(board)
    board.focus({ preventScroll: true })
    onCleanup(() => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(noticeTimer)
      timers.forEach(clearInterval)
      graph?.dispose()
      roots.forEach((dispose, id) => {
        dispose()
        hosts.delete(id)
      })
      roots.clear()
    })
  })

  return (
    <div
      ref={board}
      class="studio-board"
      tabIndex={-1}
      aria-label="Studio 图片画布"
      onKeyDown={(event) => {
        if (
          event.isComposing ||
          (event.target instanceof Element && event.target.closest("textarea, input, button, [contenteditable=true]"))
        )
          return
        if (event.key === "Escape") select("")
        if ((event.key === "Delete" || event.key === "Backspace") && state.selectedID) {
          event.preventDefault()
          removeCard(state.selectedID)
        }
      }}
    >
      <div ref={canvas} class="studio-board-graph" />
      <header class="studio-board-header">
        <div class="studio-board-header-left">
          <button type="button" class="studio-board-exit" onClick={props.onExit}>
            <BoardIcon name="back" />
            <span>退出画布</span>
          </button>
          <span class="studio-board-header-divider" />
          <span class="studio-board-name">未命名画布</span>
          <span class="studio-board-badge">DEMO</span>
        </div>
        <span class="studio-board-demo-note">模拟生成 · 退出或刷新后不保留内容</span>
      </header>
      <div class="studio-board-tools">
        <button type="button" title="添加图片任务" aria-label="添加图片任务" onClick={() => addCard()}>
          <BoardIcon name="plus" />
        </button>
        <span />
        <BoardIcon name="image" />
      </div>
      <Show when={state.cards.length === 0}>
        <div class="studio-board-empty">
          <div class="studio-board-empty-art">
            <BoardIcon name="image" />
            <span>+</span>
          </div>
          <h2>从一个想法，开始创作</h2>
          <p>添加图片任务，让灵感在画布上自由延伸</p>
          <button type="button" class="studio-board-primary" onClick={() => addCard()}>
            <BoardIcon name="plus" />
            添加图片任务
          </button>
        </div>
      </Show>
      <Show when={selected()}>
        {(card) => (
          <div
            ref={(element) => {
              composer = element
              updateAnchor()
            }}
            class="studio-board-composer"
            role="region"
            aria-label={`${card().title}的生成输入区`}
            style={{ left: `${state.anchor.left}px`, top: `${state.anchor.top}px`, width: `${state.anchor.width}px` }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <Show when={references().length > 0}>
              <div class="studio-board-references">
                <For each={references()}>
                  {(reference) => (
                    <div class="studio-board-reference">
                      <img src={reference.image} alt={reference.title} />
                      <span>{reference.title}</span>
                      <Show when={card().status === "draft"}>
                        <button
                          type="button"
                          aria-label={`移除${reference.title}的参考连接`}
                          onClick={() => {
                            const edge = state.edges.find(
                              (item) => item.sourceID === reference.sourceID && item.targetID === card().id,
                            )
                            if (edge) removeEdge(edge.id)
                          }}
                        >
                          <BoardIcon name="close" />
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <textarea
              aria-label="图片提示词"
              placeholder="描述你想生成的画面…"
              value={card().prompt}
              disabled={card().status === "running"}
              onInput={(event) =>
                setState("cards", (item) => item.id === card().id, "prompt", event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.isComposing || event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
                event.preventDefault()
                generate()
              }}
            />
            <div class="studio-board-composer-footer">
              <div class="studio-board-parameters">
                <span>
                  <img src="/studio/studio_seedream.webp" alt="" />
                  Seedream
                </span>
                <span class="studio-board-ratio-icon" /> <span>1:1</span>
                <i />
                <span>1 张</span>
              </div>
              <button
                type="button"
                class="studio-board-generate"
                aria-label={card().status === "succeeded" ? "再次生成图片" : "生成图片"}
                title="模拟生成图片（⌘ / Ctrl + Enter）"
                disabled={!card().prompt.trim() || card().status === "running"}
                onClick={generate}
              >
                <Show when={card().status === "running"} fallback={<BoardIcon name="arrow" />}>
                  <span class="studio-board-spinner" />
                </Show>
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={state.notice}>
        <div class="studio-board-notice" role="status">
          {state.notice}
        </div>
      </Show>
      <footer class="studio-board-footer">
        <span class="studio-board-help">
          拖动空白处平移 · 滚轮缩放 · 图片生成后从右侧圆点拖线到草稿左侧 · 双击连线移除
        </span>
        <div class="studio-board-zoom">
          <button type="button" aria-label="缩小画布" onClick={() => graph?.zoomTo(Math.max(0.35, state.zoom - 0.1))}>
            <BoardIcon name="minus" />
          </button>
          <button type="button" title="恢复 100%" onClick={() => graph?.zoomTo(1)}>
            {Math.round(state.zoom * 100)}%
          </button>
          <button type="button" aria-label="放大画布" onClick={() => graph?.zoomTo(Math.min(1.8, state.zoom + 0.1))}>
            <BoardIcon name="plus" />
          </button>
          <i />
          <button
            type="button"
            aria-label="适应全部卡片"
            onClick={() => graph?.zoomToFit({ padding: { top: 100, right: 80, bottom: 260, left: 80 }, maxScale: 1 })}
          >
            <BoardIcon name="fit" />
          </button>
        </div>
      </footer>
    </div>
  )
}
