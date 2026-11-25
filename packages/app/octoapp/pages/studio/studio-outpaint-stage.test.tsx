import { expect, test } from "bun:test"
import { createComponent, createRoot } from "solid-js"
import { render } from "solid-js/web"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-outpaint-dom-test",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid component could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { createStudioOutpaint, StudioOutpaintStage } = await import("./studio-outpaint-stage")

test("outpaint presets and pointer dragging account for graph zoom, contain the image and clean up capture", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Image")!
  const NativeImage = globalThis.Image
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class extends NativeImage {
      get naturalWidth() {
        return 1200
      }
      get naturalHeight() {
        return 600
      }
      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")))
      }
    },
  })
  const container = document.createElement("div")
  document.body.append(container)
  const editor = createRoot((dispose) => ({
    ...createStudioOutpaint({ source: () => "/image.png", busy: () => false, stage: { width: 768, height: 768 } }),
    dispose,
  }))
  const unmount = render(
    () => createComponent(StudioOutpaintStage, { editor, source: "/image.png", board: true, zoom: 0.5 }),
    container,
  )
  try {
    await Bun.sleep(10)
    expect(editor.canSubmit()).toBe(false)
    editor.applyRatio("1:1")
    expect(editor.metrics()).toEqual({
      sourceWidth: 1200,
      sourceHeight: 600,
      left: 0,
      right: 0,
      top: 300,
      bottom: 300,
      realWidth: 1200,
      realHeight: 1200,
    })
    editor.applyRatio("9:16")
    expect(editor.metrics().top).toBe(767)
    expect(editor.metrics().bottom).toBe(767)
    editor.applyRatio("16:9")
    expect(editor.metrics().top).toBe(38)
    expect(editor.metrics().bottom).toBe(37)
    editor.applyRatio("1:1")
    const stage = container.querySelector<HTMLElement>(".studio-enlarging-stage")!
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 384, 384)
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="调整right"]')!
    handle.setPointerCapture = () => {}
    handle.hasPointerCapture = () => false
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: 100, clientY: 100 }),
    )
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 8, clientX: 200 }))
    expect(editor.metrics().right).toBe(0)
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 115.04, clientY: 100 }))
    expect(editor.metrics().right).toBe(120)
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 7 }))
    expect(editor.state.dragging).toBe(false)
    expect(editor.state.ratio).toBeUndefined()
    expect(editor.input("  新增环境  ")).toMatchObject({ prompt: "新增环境", extra: { right: 120, numImage: 1 } })
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 9, clientX: 100, clientY: 100 }),
    )
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, clientX: -1000, clientY: 100 }))
    expect(editor.metrics().right).toBe(0)
    editor.dispose()
    expect(editor.state.dragging).toBe(false)
    const before = { ...editor.metrics() }
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, clientX: 1000 }))
    expect(editor.metrics()).toEqual(before)
  } finally {
    unmount()
    editor.dispose()
    container.remove()
    Object.defineProperty(globalThis, "Image", descriptor)
  }
})
