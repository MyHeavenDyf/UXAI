import { createSignal, onCleanup, JSX } from "solid-js"

interface CanvasViewProps {
  canvasMode: boolean
  targetWidth: number
  targetHeight: number
  children: JSX.Element
  // 将复位方法暴露给父组件，供右上角按钮调用
  ref?: (api: { reset: () => void }) => void
}

export function CanvasView(props: CanvasViewProps) {
  let viewportRef: HTMLDivElement | undefined
  let wrapperRef: HTMLDivElement | undefined

  let currentScale = 1
  let posX = 0
  let posY = 0
  let rafId: number | null = null
  let lastMousePos = { x: 0, y: 0 }

  const [isDragging, setIsDragging] = createSignal(false)

  function applyTransform() {
    if (!wrapperRef) return
    if (rafId !== null) return
    
    rafId = requestAnimationFrame(() => {
      wrapperRef!.style.transform = `translate3d(${posX}px, ${posY}px, 0) scale(${currentScale})`
      rafId = null
    })
  }

  function resetPosition() {
    if (!viewportRef) return
    const containerWidth = viewportRef.clientWidth - 40
    const containerHeight = viewportRef.clientHeight - 40
    const scaleX = containerWidth / props.targetWidth
    const scaleY = containerHeight / props.targetHeight
    
    currentScale = Math.min(scaleX, scaleY, 1)
    posX = 0
    posY = 0
    applyTransform()
  }

  // 暴露复位方法给外部
  if (props.ref) {
    props.ref({ reset: resetPosition })
  }

  let resizeObserver: ResizeObserver | undefined
  onCleanup(() => {
    resizeObserver?.disconnect()
    if (rafId !== null) cancelAnimationFrame(rafId)
  })

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

  function bindViewportRef(el: HTMLDivElement) {
    viewportRef = el
    resetPosition()
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(() => resetPosition())
    resizeObserver.observe(el)

    el.addEventListener("wheel", (e) => {
      // 只要关闭了画布模式，或者鼠标直接在 iframe 内部，不触发画布缩放
      const iframe = el.querySelector("iframe")
      if (!props.canvasMode || e.target === iframe) return
      
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const oldScale = currentScale
      currentScale = Math.min(Math.max(oldScale * delta, 0.5), 3)
      
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - rect.width / 2
      const mouseY = e.clientY - rect.top - rect.height / 2
      
      posX = mouseX - (mouseX - posX) * (currentScale / oldScale)
      posY = mouseY - (mouseY - posY) * (currentScale / oldScale)
      
      applyTransform()
    }, { passive: false })
  }

  return (
    <div
      ref={bindViewportRef}
      onMouseDown={(e) => {
        if (!props.canvasMode) return
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
          width: `${props.targetWidth}px`,
          height: `${props.targetHeight}px`,
          transform: `translate3d(${posX}px, ${posY}px, 0) scale(${currentScale})`,
          "transform-origin": "center center",
          "will-change": "transform",
          position: "relative",
          cursor: isDragging() ? "grabbing" : "default"
        }}
      >
        {/* 动态计算 iframe 的 pointer-events 状态 */}
        <div 
          style={{ 
            width: "100%", 
            height: "100%", 
            "pointer-events": isDragging() ? "none" : "auto" 
          }}
        >
          {props.children}
        </div>
        
        {/* 保护拦截层 */}
        <div 
          style={{
            position: "absolute",
            inset: 0,
            "z-index": 1,
            background: "transparent",
            "pointer-events": props.canvasMode ? "auto" : "none",
            cursor: isDragging() ? "grabbing" : "default"
          }} 
        />
      </div>
    </div>
  )
}