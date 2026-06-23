import { createSignal, onCleanup, JSX } from "solid-js"
import "../../assets/style/preview/canvasView.css"

interface CanvasViewProps {
  canvasMode: boolean
  targetWidth: number
  targetHeight: number
  children: JSX.Element
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
    // 🛠️ 性能关键点：不要在此处 return 拦截变量的更新！
    // 允许通过累计变量无损记录像素位移，通过硬件级 3D 加速瞬间同步。
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        if (wrapperRef) {
          wrapperRef.style.transform = `translate3d(${posX}px, ${posY}px, 0) scale(${currentScale})`
        }
        rafId = null
      })
    }
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

  // 🛠️ 无损像素位移收集器
  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return
    // 不断地将鼠标运动的每个像素精准累加，绝不丢弃任何微小的位移增量
    posX += e.clientX - lastMousePos.x
    posY += e.clientY - lastMousePos.y
    lastMousePos = { x: e.clientX, y: e.clientY }
    applyTransform()
  }

  const handleGlobalMouseUp = () => {
    setIsDragging(false)
  }

  // 🛠️ 核心修复点：强制拦截中键按住移动时的系统自动滚动图层，防止 mouseup 被系统吞噬导致断连
  const handleGlobalPreventScroll = (e: MouseEvent) => {
    if (isDragging() && e.button === 1) {
      e.preventDefault()
    }
  }

  window.addEventListener("mousemove", handleGlobalMouseMove)
  window.addEventListener("mouseup", handleGlobalMouseUp)
  window.addEventListener("mousedown", handleGlobalPreventScroll, { passive: false })
  
  onCleanup(() => {
    window.removeEventListener("mousemove", handleGlobalMouseMove)
    window.removeEventListener("mouseup", handleGlobalMouseUp)
    window.removeEventListener("mousedown", handleGlobalPreventScroll)
  })

  function bindViewportRef(el: HTMLDivElement) {
    viewportRef = el
    resetPosition()
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(() => resetPosition())
    resizeObserver.observe(el)

    el.addEventListener("wheel", (e) => {
      const iframe = el.querySelector("iframe")
      if (!props.canvasMode || e.target === iframe) return
      
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const oldScale = currentScale
      currentScale = Math.min(Math.max(oldScale * delta, 0.3), 3)
      
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
        if ((e.target as HTMLElement).closest(".preview-action-btn") || (e.target as HTMLElement).closest(".preview-action-icon-btn")) return
        
        const isLeftClickOnCanvas = e.button === 0
        const isMiddleClick = e.button === 1

        if (isLeftClickOnCanvas || isMiddleClick) {
          e.preventDefault()
          setIsDragging(true)
          lastMousePos = { x: e.clientX, y: e.clientY }
        }
      }}
      class="preview-iframe-canvas"
      style={{
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
          // 🛠️ 核心修改点：强行覆盖外部任何可能存在的 transition 补间动画，保证显卡 3D 绝对瞬时响应
          "transition": "none !important",
          cursor: isDragging() ? "grabbing" : "default"
        }}
      >
        <div 
          style={{ 
            width: "100%", 
            height: "100%", 
            "pointer-events": isDragging() ? "none" : "auto" 
          }}
        >
          {props.children}
        </div>
        
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