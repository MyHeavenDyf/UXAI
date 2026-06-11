import { createSignal, onCleanup } from "solid-js"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
}

export function PreviewPage(props: { api?: PreviewPageAPI }) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined
  let wrapperRef: HTMLDivElement | undefined // 用于直接原生操作 DOM

  let currentScale = 1
  let posX = 0
  let posY = 0

  // === 硬件级渲染帧锁，防止高频事件积压造成粘滞感 ===
  let rafId: number | null = null

  const [isDragging, setIsDragging] = createSignal(false)
  
  // === 控制画布拖拽缩放的模式状态（默认开启 true） ===
  const [canvasMode, setCanvasMode] = createSignal(true)
  
  let lastMousePos = { x: 0, y: 0 }

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  // 核心：通过 requestAnimationFrame 严格对齐显示器刷新率，使用 translate3d 激活显卡加速
  function applyTransform() {
    if (!wrapperRef) return
    if (rafId !== null) return // 防止画面粘滞
    
    rafId = requestAnimationFrame(() => {
      wrapperRef!.style.transform = `translate3d(${posX}px, ${posY}px, 0) scale(${currentScale})`
      rafId = null
    })
  }

  // 更新预览页大小 (兼顾复位功能)
  function updatePreviewScale() {
    if (!previewPageRef) return
    const containerWidth = previewPageRef.clientWidth - 40
    const containerHeight = previewPageRef.clientHeight - 40
    const scaleX = containerWidth / TARGET_WIDTH
    const scaleY = containerHeight / TARGET_HEIGHT
    
    currentScale = Math.min(scaleX, scaleY, 1)
    posX = 0
    posY = 0
    applyTransform()
  }

  let previewResizeObserver: ResizeObserver | undefined
  onCleanup(() => {
    previewResizeObserver?.disconnect()
    if (rafId !== null) cancelAnimationFrame(rafId)
  })

  // 丝滑拖拽
  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return
    posX += e.clientX - lastMousePos.x
    posY += e.clientY - lastMousePos.y
    lastMousePos = { x: e.clientX, y: e.clientY }
    applyTransform()
  }

  const handleGlobalMouseUp = () => {
    setIsDragging(false)
  }

  window.addEventListener("mousemove", handleGlobalMouseMove)
  window.addEventListener("mouseup", handleGlobalMouseUp)
  onCleanup(() => {
    window.removeEventListener("mousemove", handleGlobalMouseMove)
    window.removeEventListener("mouseup", handleGlobalMouseUp)
  })

  function bindpreviewPageRef(el: HTMLDivElement) {
    previewPageRef = el
    updatePreviewScale()
    previewResizeObserver?.disconnect()
    previewResizeObserver = new ResizeObserver(() => updatePreviewScale())
    previewResizeObserver.observe(el)

    // 丝滑缩放
    el.addEventListener("wheel", (e) => {
      // 🛠️ 核心拦截修改：只要关闭了画布模式，滚轮绝对不响应任何画布缩放
      if (!canvasMode() || e.target === previewIframeRef) return
      
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const oldScale = currentScale
      currentScale = Math.min(Math.max(oldScale * delta, 0.1), 5)
      
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - rect.width / 2
      const mouseY = e.clientY - rect.top - rect.height / 2
      
      posX = mouseX - (mouseX - posX) * (currentScale / oldScale)
      posY = mouseY - (mouseY - posY) * (currentScale / oldScale)
      
      applyTransform()
    }, { passive: false })
  }

  // 发送数据
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

  return (
    <div 
      ref={bindpreviewPageRef} 
      class="flex flex-col overflow-hidden" 
      style={{ 
        position: "relative",
        cursor: isDragging() ? "grabbing" : "default"
      }}
    >
      <div class="absolute right-[12px] top-[12px] flex gap-[6px]" style={{ "z-index": 10 }}>
        
        {/* === 画布/拖拽模式切换按钮 === */}
        <button 
          class="preview-action-btn" 
          title={canvasMode() ? "当前：画布模式（可自由拖拽缩放）" : "当前：页面操作模式（可触发内层交互）"}
          onClick={() => setCanvasMode(!canvasMode())}
          style={{
            "background-color": canvasMode() ? "#3b82f6" : "",
            "color": canvasMode() ? "white" : "currentColor"
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            {canvasMode() ? (
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a2 2 0 114 0v4m0 0V9a2 2 0 114 0v2m0 0v-1a2 2 0 114 0v3a7 7 0 11-14 0v-4a2 2 0 114 0v3" />
            ) : (
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4l7.14 16.29a.5.5 0 00.93-.16l2.19-6.42 6.42-2.19a.5.5 0 00.16-.93L4 4z" />
            )}
          </svg>
        </button>

        <button 
          class="preview-action-btn" 
          title="居中复位"
          onClick={updatePreviewScale}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <circle cx="12" cy="12" r="3" stroke-width="2"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
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
        onMouseDown={(e) => {
          // 🛠️ 核心拦截修改：只要 canvasMode 为 false（即非拖拽模式），左键、中键统统在这里被拦截，绝对不触发拖拽
          if (!canvasMode()) return
          
          if ((e.target as HTMLElement).closest(".preview-action-btn")) return
          
          const isLeftClickOnCanvas = e.button === 0
          const isMiddleClick = e.button === 1

          if (isLeftClickOnCanvas || isMiddleClick) {
            e.preventDefault()
            setIsDragging(true)
            lastMousePos = { x: e.clientX, y: e.clientY }
          }
        }}
        style={{
          flex: "1",
          "min-height": "0",
          overflow: "hidden",
          display: "flex",
          "justify-content": "center",
          "align-items": "center",
          padding: "20px",
          position: "relative",
          cursor: isDragging() ? "grabbing" : "default"
        }}
      >
        <div
          ref={(el) => { wrapperRef = el }}
          class="preview-iframe-wrapper"
          style={{
            width: `${TARGET_WIDTH}px`,
            height: `${TARGET_HEIGHT}px`,
            transform: `translate3d(${posX}px, ${posY}px, 0) scale(${currentScale})`,
            "transform-origin": "center center",
            "will-change": "transform",
            position: "relative",
            cursor: isDragging() ? "grabbing" : "default"
          }}
        >
          <iframe 
            ref={(el) => { previewIframeRef = el }} 
            src="http://127.0.0.1:8989" 
            style={{ 
              width: "100%", 
              height: "100%", 
              border: "none",
              "pointer-events": isDragging() ? "none" : "auto"
            }} 
          />
          
          {/* 保护层：在画布模式激活时，拦截鼠标动作以保护拖拽事件 */}
          <div 
            style={{
              position: "absolute",
              inset: 0,
              "z-index": 1,
              background: "transparent",
              "pointer-events": canvasMode() ? "auto" : "none",
              cursor: isDragging() ? "grabbing" : "default"
            }} 
          />
        </div>
      </div>
    </div>
  )
}