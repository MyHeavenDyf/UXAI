import { createSignal, onCleanup } from "solid-js"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
}

export function PreviewPage(props: { api?: PreviewPageAPI }) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined
  const [previewScale, setPreviewScale] = createSignal(1)

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  // 更新预览页大小
  function updatePreviewScale() {
    if (!previewPageRef) return
    const containerWidth = previewPageRef.clientWidth - 40
    const containerHeight = previewPageRef.clientHeight - 40
    const scaleX = containerWidth / TARGET_WIDTH
    const scaleY = containerHeight / TARGET_HEIGHT
    setPreviewScale(Math.min(scaleX, scaleY, 1))
  }

  let previewResizeObserver: ResizeObserver | undefined
  onCleanup(() => previewResizeObserver?.disconnect())

  function bindpreviewPageRef(el: HTMLDivElement) {
    previewPageRef = el
    updatePreviewScale()
    previewResizeObserver?.disconnect()
    previewResizeObserver = new ResizeObserver(() => updatePreviewScale())
    previewResizeObserver.observe(el)
  }

  // 发送数据
  function sendToPreview(data: unknown) {
    if (!previewIframeRef?.contentWindow) return
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  if (props.api) {
    props.api.sendToPreview = sendToPreview
  }

  return (
    <div ref={bindpreviewPageRef} class="flex flex-col overflow-hidden" style="position:relative">
      <div class="absolute right-[12px] top-[12px] flex gap-[6px]" style={{ "z-index": 10 }}>
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
        style={{
          flex: "1",
          "min-height": "0",
          overflow: "hidden",
          display: "flex",
          "justify-content": "center",
          "align-items": "center",
          padding: "20px",
          position: "relative",
        }}
      >
        <div
          class="preview-iframe-wrapper"
          style={{
            width: `${TARGET_WIDTH}px`,
            height: `${TARGET_HEIGHT}px`,
            transform: `scale(${previewScale()})`,
          }}
        >
          <iframe ref={(el) => { previewIframeRef = el }} src="http://127.0.0.1:8989" />
        </div>
      </div>
    </div>
  )
}
