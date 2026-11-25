import { expect, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "update-dialog-dom-test",
  setup(build) {
    build.onLoad({ filter: /(?:dialog-update-available|update-description|dialog|i18n|icon-button|icon|platform|helper)\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Update dialog could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})

const { DialogProvider, useDialog } = await import("@opencode-ai/ui/context/dialog")
const { PlatformProvider } = await import("../context/platform")
const { useUpdateAvailableDialog } = await import("./dialog-update-available")

function mount(os: "windows" | "macos", updateAndRestart = async () => {}) {
  const state = { openedLinks: 0, closed: 0 }
  const controls = { open: (_forced: boolean) => {}, close: () => {}, replace: () => {} }
  function Harness() {
    const dialog = useDialog()
    const show = useUpdateAvailableDialog()
    controls.open = (forced) => show("3.3.3", "更新说明", () => { state.closed += 1 }, forced)
    controls.close = () => dialog.close()
    controls.replace = () => dialog.show(() => "其他弹窗")
    return null
  }
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => createComponent(PlatformProvider, {
    value: {
      platform: "desktop", os, openLink: () => { state.openedLinks += 1 },
      restart: async () => {}, back: () => {}, forward: () => {}, notify: async () => {}, updateAndRestart,
    },
    get children() {
      return createComponent(DialogProvider, { get children() { return createComponent(Harness, {}) } })
    },
  }), container)
  return { state, controls, dispose: () => { dispose(); container.remove() } }
}

const content = () => document.querySelector(".octo-update-dialog")
const upgrade = () => document.querySelector<HTMLButtonElement>(".octo-update-dialog-upgrade")!

test.each(["escape", "overlay", "close"] as const)("ordinary updates remain dismissible via %s", async (action) => {
  const app = mount("windows")
  try {
    app.controls.open(false)
    await Bun.sleep(10)
    expect(document.querySelector(".octo-update-dialog-close")).not.toBeNull()
    expect(document.querySelector(".octo-update-dialog-later")).not.toBeNull()
    if (action === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    if (action === "overlay") document.querySelector<HTMLElement>('[data-component="dialog-overlay"]')!.click()
    if (action === "close") app.controls.close()
    await Bun.sleep(150)
    expect(content()).toBeNull()
    expect(app.state.closed).toBe(1)
  } finally { app.dispose() }
})

test.each(["windows", "macos"] as const)("forced %s updates block all dismissal paths and dialog replacement", async (os) => {
  const app = mount(os)
  try {
    app.controls.open(true)
    await Bun.sleep(10)
    expect(document.querySelector(".octo-update-dialog-close")).toBeNull()
    expect(document.querySelector(".octo-update-dialog-later")).toBeNull()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    document.querySelector<HTMLElement>('[data-component="dialog-overlay"]')!.click()
    app.controls.close()
    app.controls.replace()
    await Bun.sleep(150)
    expect(content()).not.toBeNull()
    expect(app.state.closed).toBe(0)
    if (os === "macos") {
      upgrade().click()
      await Bun.sleep(150)
      expect(app.state.openedLinks).toBe(1)
      expect(content()).not.toBeNull()
    }
  } finally { app.dispose() }
})

test("forced Windows update remains locked and allows retry after download failure", async () => {
  const state = { attempts: 0 }
  const app = mount("windows", async () => { state.attempts += 1; throw new Error("download failed") })
  try {
    app.controls.open(true)
    await Bun.sleep(10)
    upgrade().click()
    await Bun.sleep(10)
    expect(upgrade().textContent).toBe("重试下载")
    expect(upgrade().disabled).toBe(false)
    upgrade().click()
    await Bun.sleep(10)
    expect(state.attempts).toBe(2)
    app.controls.close()
    await Bun.sleep(150)
    expect(content()).not.toBeNull()
  } finally { app.dispose() }
})
