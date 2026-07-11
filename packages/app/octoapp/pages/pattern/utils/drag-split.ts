import { createSignal, onCleanup } from "solid-js"

/** 聊天面板宽度持久化 key */
const STORAGE_KEY = "octo:pattern:chat-width"
/** 聊天面板最小宽度 */
const MIN_WIDTH = 345
/** 聊天面板最大宽度 */
const MAX_WIDTH = 720
/** 聊天面板默认宽度 */
const DEFAULT_WIDTH = 460

/** 从 localStorage 读取上次保存的面板宽度 */
function getInitialWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const n = parseInt(stored, 10)
    if (!isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n
  }
  return DEFAULT_WIDTH
}

/**
 * 创建聊天/预览面板分隔线拖拽控制器。
 * 返回 chatWidth（面板宽度信号）、focusMode（焦点模式信号）和 onDividerMouseDown（拖拽事件处理器）。
 * 拖拽宽度自动持久化到 localStorage，组件卸载时清理事件监听。
 */
export function createSplitDrag() {
  const [chatWidth, setChatWidth] = createSignal(getInitialWidth())
  const [focusMode, setFocusMode] = createSignal(false)

  let dragCleanup: (() => void) | null = null

  function onDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()

    // mousedown 时锁定 body，防止拖拽时触发文本选择
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    const resetBody = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      dragCleanup = null
    }

    const onMove = (ev: MouseEvent) => {
      setChatWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX)))
    }

    const onUp = () => {
      resetBody()
      localStorage.setItem(STORAGE_KEY, String(chatWidth()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)

    // 记录清理函数，供组件卸载时调用
    dragCleanup = () => {
      resetBody()
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }

  onCleanup(() => { dragCleanup?.() })

  return { chatWidth, focusMode, setFocusMode, onDividerMouseDown }
}
