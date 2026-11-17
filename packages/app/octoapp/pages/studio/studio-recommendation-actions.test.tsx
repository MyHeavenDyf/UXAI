import { expect, spyOn, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { createRecommendationMode } from "./studio-recommendation-mode"
import type { StudioCapability } from "./types"
import type { StudioComposerMenu } from "./studio-composer"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-composer-recommendation-dom-test",
  setup(build) {
    build.onLoad({ filter: /\.(svg|png)$/ }, (args) => ({ contents: `export default ${JSON.stringify(args.path)}`, loader: "js" }))
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid component could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { StudioComposer } = await import("./studio-composer")
const { PlatformProvider } = await import("@/context/platform")

function setup(model = "seedream-5-lite") {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      enabled: true, capability: "image.generate" as StudioCapability,
      entries: {} as Record<string, StudioCapability>,
      menu: null as StudioComposerMenu, model, submitted: 0,
      seedream: true, customWidth: 0, customHeight: 0, isCustom: false,
    })
    const mode = createRecommendationMode({
      key: () => "session", enabled: () => state.enabled, ready: () => true, busy: () => false,
      entries: () => state.entries, save: (key, value) => setState("entries", key, value),
      global: () => state.capability, setGlobal: (value) => setState("capability", value),
    })
    const telemetry = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({}), { preconnect: globalThis.fetch.preconnect }))
    const container = document.createElement("div")
    document.body.append(container)
    const noop = () => {}
    const unmount = render(() => createComponent(PlatformProvider, {
      value: { platform: "web", openLink: noop, restart: async () => {}, back: noop, forward: noop, notify: async () => {} },
      get children() {
        return createComponent(StudioComposer, {
          prompt: "一只猫", get capability() { return mode.capability() },
          get recommendationEnabled() { return mode.active() },
          get styleModel() { return state.model },
          get openMenu() { return state.menu },
          canGenerateVideo: true, get canUseSeedream() { return state.seedream }, canCreateStyleTemplate: false,
          permissionStatus: "ready", onRetryPermission: noop,
          maxReferenceImages: 3, aspectRatio: "3:4", count: 1,
          get customWidth() { return state.customWidth },
          get customHeight() { return state.customHeight },
          get isCustom() { return state.isCustom },
          assets: [], videoFrames: {}, videoDuration: "5", videoQualityMode: "480", videoMode: "all-reference",
          status: "idle", busy: false, canSubmit: true, actionsBlocked: false,
          styleTemplateEditorOpen: false, recipeMainPrompt: "", recipeExtraPrompt: "",
          onPrompt: noop, onCapability: mode.select, onStyleModel: (value) => setState("model", value),
          onOpenMenu: (value) => setState("menu", value),
          onAspectRatio: noop, onCount: noop,
          onCustomWidth: (value) => setState("customWidth", value),
          onCustomHeight: (value) => setState("customHeight", value),
          onIsCustom: (value) => setState("isCustom", value),
          onVideoDuration: noop, onVideoQualityMode: noop, onVideoMode: noop,
          onStyleTemplateEditorOpen: noop, onStyleTemplateDescription: noop, onRestoreStyleTemplateDescription: noop,
          onRecipeMainPrompt: noop, onRecipeExtraPrompt: noop,
          onSubmit: () => setState("submitted", (value) => value + 1), onKeyDown: noop,
          onPickFile: noop, onPickVideoFrame: noop, onPasteImage: noop,
          onDropFiles: noop, onDropImageUrl: noop, onRemoveAsset: noop, onRemoveVideoFrame: noop, onSwapVideoFrames: noop,
          onExitRecommendation: () => setState("enabled", false),
        })
      },
    }), container)
    return { container, state, setState, mode, dispose: () => { unmount(); container.remove(); telemetry.mockRestore(); dispose() } }
  })
}

function button(container: HTMLElement, label: string) {
  const node = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.trim() === label)
  if (!node) throw new Error(`Missing button: ${label}`)
  return node
}

test("the real composer suspends its recommendation chip and send label in video, then restores them", () => {
  const value = setup()
  try {
    expect(value.container.querySelector("[data-studio-recommendation-chip]")).not.toBeNull()
    expect(value.container.querySelector(".studio-composer-send")?.getAttribute("title")).toBe("图片提示词扩写")
    button(value.container, "图片生成").click()
    button(value.container, "视频生成").click()
    expect(value.mode.capability()).toBe("video.generate")
    expect(value.state.enabled).toBe(true)
    expect(value.container.querySelector("[data-studio-recommendation-chip]")).toBeNull()
    expect(value.container.querySelector(".studio-composer-send")?.getAttribute("title")).toBe("生成")
    expect(value.container.querySelector(".studio-composer-video-frames")).not.toBeNull()
    value.container.querySelector<HTMLButtonElement>(".studio-composer-send")?.click()
    expect(value.state.submitted).toBe(1)
    button(value.container, "视频生成").click()
    button(value.container, "图片生成").click()
    expect(value.container.querySelector("[data-studio-recommendation-chip]")).not.toBeNull()
    expect(value.container.querySelector(".studio-composer-send")?.getAttribute("title")).toBe("图片提示词扩写")
  } finally { value.dispose() }
})

test.each(["seedream-5-lite", "seedream-5-pro"])("recommendation leaves %s selectors usable while restricting templates and mentions", (model) => {
  const value = setup(model)
  try {
    expect(button(value.container, "图片生成").disabled).toBe(false)
    expect(button(value.container, "风格模板").disabled).toBe(true)
    expect(value.container.querySelector(".studio-composer-icon-at")).toBeNull()
    const selector = value.container.querySelector<HTMLButtonElement>(".studio-composer-toolbar-item--style button")
    expect(selector?.disabled).toBe(false)
    selector?.click()
    const option = value.container.querySelector<HTMLButtonElement>(".studio-style-option:not(.active)")
    expect(option).not.toBeNull()
    option?.click()
    expect(value.state.model).not.toBe(model)
    expect(value.state.enabled).toBe(true)
    value.setState("model", model)
    value.setState("menu", null)
    value.setState("enabled", false)
    expect(button(value.container, "风格模板").disabled).toBe(false)
    expect(value.container.querySelector(".studio-composer-icon-at")).not.toBeNull()
  } finally { value.dispose() }
})

test("the model menu shows Pro before Lite and filters both with the same permission", () => {
  const value = setup("seedream-5-pro")
  try {
    value.setState("menu", "style")
    expect(Array.from(value.container.querySelectorAll(".studio-style-option")).slice(0, 3).map((node) => node.getAttribute("title")))
      .toEqual(["Seedream 5.0 Pro", "Seedream 5.0 Lite", "千问"])
    value.setState("seedream", false)
    expect(value.container.querySelector('[title="Seedream 5.0 Pro"].studio-style-option')).toBeNull()
    expect(value.container.querySelector('[title="Seedream 5.0 Lite"].studio-style-option')).toBeNull()
    expect(value.container.querySelector('[title="千问"].studio-style-option')).not.toBeNull()
  } finally { value.dispose() }
})

test.each([
  ["seedream-5-pro", true],
  ["seedream-5-lite", false],
] as const)("the real %s settings validate and commit 1280 × 720", async (model, valid) => {
  const value = setup(model)
  try {
    value.setState("enabled", false)
    value.setState("menu", "settings")
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = "1280"
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = "720"
    height.dispatchEvent(new Event("input", { bubbles: true }))
    await Bun.sleep(650)
    const warning = value.container.querySelector<HTMLElement>(".studio-image-settings-size-warn-text")!
    expect(warning.style.visibility).toBe(valid ? "hidden" : "visible")
    if (!valid) expect(warning.textContent).toContain("2560×1440")
    value.setState("menu", null)
    expect(value.state.isCustom).toBe(valid)
    if (valid) {
      expect(value.state.customWidth).toBe(1280)
      expect(value.state.customHeight).toBe(720)
      expect(value.container.textContent).toContain("1280×720")
    }
  } finally { value.dispose() }
})

test("Pro settings use their own warning and integer range when correcting dimensions on blur", async () => {
  const value = setup("seedream-5-pro")
  try {
    value.setState("enabled", false)
    value.setState("menu", "settings")
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = "1280"
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = "719"
    height.dispatchEvent(new Event("input", { bubbles: true }))
    await Bun.sleep(650)
    const warning = value.container.querySelector<HTMLElement>(".studio-image-settings-size-warn-text")!
    expect(warning.style.visibility).toBe("visible")
    expect(warning.textContent).toContain("1280×720, 2048×2048×1.1025")
    height.dispatchEvent(new FocusEvent("blur"))
    expect(height.value).toBe("720")
    value.setState("menu", null)
    expect(value.state.isCustom).toBe(true)
    expect(value.state.customHeight).toBe(720)
  } finally { value.dispose() }
})

test("the toolbar does not retain a Lite-only custom label after selecting Pro", () => {
  const value = setup("seedream-5-lite")
  try {
    value.setState({ enabled: false, customWidth: 3072, customHeight: 3072, isCustom: true })
    expect(value.container.textContent).toContain("3072×3072")
    value.setState("model", "seedream-5-pro")
    expect(value.container.textContent).not.toContain("3072×3072")
  } finally { value.dispose() }
})
