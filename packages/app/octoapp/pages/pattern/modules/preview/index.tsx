import { createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
const ZOOM_STEP = 0.1
const TARGET_WIDTH = 1920
const TARGET_HEIGHT = 1080
const DEFAULT_ZOOM = 0.4

export function PreviewPage(props: { api?: PreviewPageAPI }) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined
  let viewportRef: HTMLDivElement | undefined
  const [zoom, setZoom] = createSignal(DEFAULT_ZOOM)
  const [pan, setPan] = createStore({ x: 0, y: 0 })
  const [vpSize, setVpSize] = createStore({ w: 0, h: 0 })
  const [dragging, setDragging] = createSignal(false)
  let dragStart = { x: 0, y: 0, panX: 0, panY: 0 }
  let resizeObserver: ResizeObserver | undefined

  const cx = () => (vpSize.w - TARGET_WIDTH * zoom()) / 2
  const cy = () => (vpSize.h - TARGET_HEIGHT * zoom()) / 2
  const tx = () => cx() + pan.x
  const ty = () => cy() + pan.y

  function sendToPreview(data: unknown) {
    if (!previewIframeRef?.contentWindow) return
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  if (props.api) {
    props.api.sendToPreview = sendToPreview
    props.api.postMessage = (data: unknown) => {
      if (!previewIframeRef?.contentWindow) return
      previewIframeRef.contentWindow.postMessage(data, "*")
    }
    props.api.refresh = () => {
      if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989"
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    if (!viewportRef) return

    const rect = viewportRef.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const oldZoom = zoom()
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    const newZoom = Math.round(Math.min(Math.max(oldZoom + delta, MIN_ZOOM), MAX_ZOOM) * 100) / 100

    if (newZoom === oldZoom) return

    const oldTotalX = tx()
    const oldTotalY = ty()
    const scale = newZoom / oldZoom

    const newTotalX = mouseX - scale * (mouseX - oldTotalX)
    const newTotalY = mouseY - scale * (mouseY - oldTotalY)

    const newCx = (vpSize.w - TARGET_WIDTH * newZoom) / 2
    const newCy = (vpSize.h - TARGET_HEIGHT * newZoom) / 2

    setPan({ x: newTotalX - newCx, y: newTotalY - newCy })
    setZoom(newZoom)
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 1) return
    e.preventDefault()
    setDragging(true)
    dragStart = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!dragging()) return
    setPan({
      x: dragStart.panX + (e.clientX - dragStart.x),
      y: dragStart.panY + (e.clientY - dragStart.y),
    })
  }

  function handleMouseUp(e: MouseEvent) {
    if (e.button !== 1) return
    setDragging(false)
  }

  function resetZoom() {
    setZoom(DEFAULT_ZOOM)
    setPan({ x: 0, y: 0 })
  }

  function handleAuxClick(e: MouseEvent) {
    e.preventDefault()
  }

  onCleanup(() => {
    window.removeEventListener("mousemove", handleMouseMove)
    window.removeEventListener("mouseup", handleMouseUp)
    resizeObserver?.disconnect()
  })

  return (
    <div ref={(el) => { previewPageRef = el }} class="flex flex-col overflow-hidden" style="position:relative">
      <div class="absolute right-[12px] top-[12px] flex items-center gap-[6px]" style={{ "z-index": 10 }}>
        <button
          class="preview-action-btn"
          title="恢复原始位置"
          onClick={resetZoom}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <circle cx="12" cy="12" r="3" stroke-width="2" />
            <path stroke-linecap="round" stroke-width="2" d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
        <button class="preview-action-btn" title="历史版本">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        <button
          class="preview-action-btn"
          title="刷新"
          onClick={() => {
            if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989"
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <button
          class="preview-action-btn"
          title="全屏"
          onClick={() => {
            if (previewPageRef?.requestFullscreen) previewPageRef.requestFullscreen()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>
      </div>
      <div
        ref={(el) => {
          viewportRef = el
          resizeObserver?.disconnect()
          const update = () => setVpSize({ w: el.clientWidth, h: el.clientHeight })
          update()
          resizeObserver = new ResizeObserver(update)
          resizeObserver.observe(el)
        }}
        style={{
          flex: "1",
          "min-height": "0",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${TARGET_WIDTH}px`,
            height: `${TARGET_HEIGHT}px`,
            transform: `translate(${tx()}px, ${ty()}px) scale(${zoom()})`,
            "transform-origin": "0 0",
          }}
        >
          <iframe
            ref={(el) => { previewIframeRef = el }}
            src="http://127.0.0.1:8989"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            inset: "0",
            "z-index": 5,
            cursor: dragging() ? "grabbing" : "grab",
          }}
          onWheel={handleWheel}
          onMouseDown={(e) => {
            handleMouseDown(e)
            window.addEventListener("mousemove", handleMouseMove)
            window.addEventListener("mouseup", handleMouseUp)
          }}
          onAuxClick={handleAuxClick}
        />
      </div>
    </div>
  )
}
