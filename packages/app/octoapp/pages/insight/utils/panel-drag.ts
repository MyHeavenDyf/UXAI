/** Insight 属性面板独立拖拽；host 是面板容器，父元素是 HTML 预览区。 */
export function attachPanelDrag(host: HTMLElement, disabled: () => boolean) {
  const region = host.parentElement!
  let active: { id: number; x: number; y: number; left: number; top: number } | undefined
  let moved = false
  const position = (left: number, top: number) => {
    const panel = host.querySelector<HTMLElement>(".manual-edit-right")
    const bounds = region.getBoundingClientRect()
    const rect = panel?.getBoundingClientRect() ?? host.getBoundingClientRect()
    const x = Math.min(Math.max(8, left), Math.max(8, bounds.width - rect.width - 8))
    const y = Math.min(Math.max(8, top), Math.max(8, bounds.height - rect.height - 8))
    host.style.left = `${x}px`
    host.style.top = `${y}px`
    host.style.right = "auto"
    host.style.height = `${Math.max(0, bounds.height - y - 12)}px`
    moved = true
  }
  const stop = () => {
    if (!active) return
    const id = active.id
    active = undefined
    region.classList.remove("insight-panel-dragging")
    if (host.hasPointerCapture(id)) host.releasePointerCapture(id)
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || disabled() || active || !(event.target instanceof Element)) return
    const title = event.target.closest(".manual-edit-titlebar")
    if (!title || !host.contains(title) || event.target.closest("button, input, textarea, select, a, [role='button']")) return
    const bounds = region.getBoundingClientRect()
    const rect = host.getBoundingClientRect()
    event.preventDefault()
    event.stopPropagation()
    active = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left - bounds.left, top: rect.top - bounds.top }
    region.classList.add("insight-panel-dragging")
    host.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.id) return
    if (disabled()) { stop(); return }
    event.preventDefault()
    position(active.left + event.clientX - active.x, active.top + event.clientY - active.y)
  }
  const up = (event: PointerEvent) => { if (event.pointerId === active?.id) stop() }
  const resize = new ResizeObserver(() => {
    if (moved) position(parseFloat(host.style.left), parseFloat(host.style.top))
  })
  resize.observe(region)
  host.addEventListener("pointerdown", down, true)
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", up)
  host.addEventListener("lostpointercapture", stop)
  window.addEventListener("blur", stop)
  return () => {
    stop()
    resize.disconnect()
    host.removeEventListener("pointerdown", down, true)
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", up)
    host.removeEventListener("lostpointercapture", stop)
    window.removeEventListener("blur", stop)
  }
}
