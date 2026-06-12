import { createSignal } from "solid-js"
import { TitleBar } from "./TitleBar"
import { CanvasView } from "./CanvasView"
import "./PreviewStyles.css"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
}

export function PreviewPage(props: { api?: PreviewPageAPI }) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined
  let canvasRef: { reset: () => void } | undefined

  const [canvasMode, setCanvasMode] = createSignal(true)

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  function triggerRefresh() {
    if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989"
  }

  // === 核心：统一选项改变的处理逻辑 ===
  function handleTitleBarOptionChange(type: "preview" | "device" | "zoom", value: string) {
    console.log(`切换类型: ${type}, 选中值: ${value}`)
    
    // 联动预留：例如当缩放下拉选择 "适应屏幕" 时，可以直接触发画布复位
    if (type === "zoom" && value === "auto") {
      canvasRef?.reset()
    }
    
    // 这里未来可以根据需要，通过 props.api 发送给 iframe 或者改变本地其它 state
  }

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
    props.api.refresh = triggerRefresh
  }

  return (
    <div ref={(el) => { previewPageRef = el }} class="preview-container">
      <TitleBar
        canvasMode={canvasMode()}
        onToggleCanvasMode={() => setCanvasMode(!canvasMode())}
        onReset={() => canvasRef?.reset()}
        onRefresh={triggerRefresh}
        onFullscreen={() => {
          if (previewPageRef?.requestFullscreen) previewPageRef.requestFullscreen()
        }}
        // 挂载选项改变的处理事件
        onOptionChange={handleTitleBarOptionChange}
      />

      <CanvasView 
        ref={(el) => { canvasRef = el }}
        canvasMode={canvasMode()} 
        targetWidth={TARGET_WIDTH} 
        targetHeight={TARGET_HEIGHT}
      >
        <iframe 
          ref={(el) => { previewIframeRef = el }} 
          src="http://127.0.0.1:8989" 
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </CanvasView>
    </div>
  )
}