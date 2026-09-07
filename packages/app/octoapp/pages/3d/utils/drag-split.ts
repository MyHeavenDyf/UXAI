import { createSignal, onCleanup } from "solid-js"

const STORAGE_KEY = "octo:3d:chat-width"
const MIN_WIDTH = 345
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 420

function getInitialWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const n = parseInt(stored, 10)
    if (!isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n
  }
  return DEFAULT_WIDTH
}

export function createSplitDrag() {
  const [chatWidth, setChatWidth] = createSignal(getInitialWidth())
  const [focusMode, setFocusMode] = createSignal(false)

  let dragCleanup: (() => void) | null = null

  function onDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    // 全屏透明遮罩：拖拽期间盖住 iframe（Three.js 场景），防止 iframe 吞掉 mousemove 事件
    // + 减少 mousemove 频率对 iframe 的 reflow/resize 冲击。mouseup 后移除。
    const overlay = document.createElement("div")
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize;"
    document.body.appendChild(overlay)

    // rAF 节流：每帧最多更新一次列宽，避免高频 mousemove 触发 Three.js renderer.setSize
    let rafId = 0
    let pendingX: number | null = null
    const flush = () => {
      rafId = 0
      if (pendingX === null) return
      setChatWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + pendingX - startX)))
      pendingX = null
    }

    const resetBody = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      overlay.remove()
      if (rafId) cancelAnimationFrame(rafId)
      dragCleanup = null
    }

    const onMove = (ev: MouseEvent) => {
      pendingX = ev.clientX
      if (!rafId) rafId = requestAnimationFrame(flush)
    }

    const onUp = () => {
      resetBody()
      localStorage.setItem(STORAGE_KEY, String(chatWidth()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)

    dragCleanup = () => {
      resetBody()
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }

  onCleanup(() => { dragCleanup?.() })

  return { chatWidth, focusMode, setFocusMode, onDividerMouseDown }
}
