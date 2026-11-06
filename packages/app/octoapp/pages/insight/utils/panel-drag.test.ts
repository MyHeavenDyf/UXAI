import { afterEach, expect, test } from "bun:test"
import { attachPanelDrag } from "./panel-drag"

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()))
function setup(disabled = () => false) {
  const region = document.createElement("div")
  region.innerHTML = '<div><aside class="manual-edit-right"><div class="manual-edit-titlebar"><span>属性</span><button>关闭</button></div><input /></aside></div>'
  document.body.append(region)
  const host = region.firstElementChild as HTMLElement
  const panel = host.firstElementChild as HTMLElement
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) })
  region.getBoundingClientRect = () => rect(10, 20, 800, 600)
  host.getBoundingClientRect = () => rect(530, 32, 268, 576)
  panel.getBoundingClientRect = () => rect(530, 32, 268, 300)
  const captured = new Set<number>()
  host.setPointerCapture = id => { captured.add(id) }
  host.hasPointerCapture = id => captured.has(id)
  host.releasePointerCapture = id => { captured.delete(id) }
  cleanups.push(() => region.remove(), attachPanelDrag(host, disabled))
  const fire = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y }))
  return { host, region, captured, fire, title: host.querySelector("span")!, button: host.querySelector("button")!, input: host.querySelector("input")! }
}

test("标题拖动更新位置，松手后停止，拖动时屏蔽 iframe", () => {
  const view = setup()
  view.fire(view.title, "pointerdown", 550, 40)
  expect(view.region.classList.contains("insight-panel-dragging")).toBe(true)
  expect(view.captured.has(1)).toBe(true)
  view.fire(window, "pointermove", 450, 140)
  expect(view.host.style.left).toBe("420px")
  expect(view.host.style.top).toBe("112px")
  view.fire(window, "pointerup", 450, 140)
  view.fire(window, "pointermove", 300, 200)
  expect(view.host.style.left).toBe("420px")
  expect(view.captured.size).toBe(0)
  expect(view.region.classList.contains("insight-panel-dragging")).toBe(false)
})

test("拖动限制在预览边界，窗口失焦终止", () => {
  const view = setup()
  view.fire(view.title, "pointerdown", 550, 40)
  view.fire(window, "pointermove", -1000, -1000)
  expect(view.host.style.left).toBe("8px")
  expect(view.host.style.top).toBe("8px")
  view.fire(window, "pointermove", 3000, 3000)
  expect(view.host.style.left).toBe("524px")
  expect(view.host.style.top).toBe("292px")
  window.dispatchEvent(new Event("blur"))
  expect(view.captured.size).toBe(0)
})

test("按钮、输入框和忙碌状态不触发拖动，卸载移除监听", () => {
  const view = setup()
  view.fire(view.button, "pointerdown", 550, 40)
  view.fire(view.input, "pointerdown", 550, 40)
  expect(view.captured.size).toBe(0)
  const busy = setup(() => true)
  busy.fire(busy.title, "pointerdown", 550, 40)
  expect(busy.captured.size).toBe(0)
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  view.fire(view.title, "pointerdown", 550, 40)
  expect(view.captured.size).toBe(0)
})
