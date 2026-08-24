/**
 * 拖拽侧栏宽度期间禁用 iframe 的指针事件。
 *
 * 松开鼠标时 mouseup 会被跨域 iframe 吞掉(onUp 不触发,拖拽状态卡死),
 * 故拖拽期间把所有 iframe 的 pointerEvents 置 none,结束后还原。
 *
 * 还原时写回拖拽前的原值,避免把原本就是 none 的 iframe 错改成 auto。
 * 返回一个 restore 函数,在 onUp 中调用即可。
 */
export function disableIframesDuringDrag(): () => void {
  const frames = [...document.querySelectorAll("iframe")]
  const saved = frames.map((f) => f.style.pointerEvents)
  frames.forEach((f) => (f.style.pointerEvents = "none"))
  return () => frames.forEach((f, i) => (f.style.pointerEvents = saved[i]))
}
