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

function setup() {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      enabled: true, capability: "image.generate" as StudioCapability,
      entries: {} as Record<string, StudioCapability>,
      menu: null as StudioComposerMenu, model: "seedream-5-lite", submitted: 0,
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
          canGenerateVideo: true, canUseSeedream: true, canCreateStyleTemplate: false,
          permissionStatus: "ready", onRetryPermission: noop,
          maxReferenceImages: 3, aspectRatio: "3:4", count: 1,
          customWidth: 0, customHeight: 0, isCustom: false,
          assets: [], videoFrames: {}, videoDuration: "5", videoQualityMode: "480", videoMode: "all-reference",
          status: "idle", busy: false, canSubmit: true, actionsBlocked: false,
          styleTemplateEditorOpen: false, recipeMainPrompt: "", recipeExtraPrompt: "",
          onPrompt: noop, onCapability: mode.select, onStyleModel: (value) => setState("model", value),
          onOpenMenu: (value) => setState("menu", value),
          onAspectRatio: noop, onCount: noop, onCustomWidth: noop, onCustomHeight: noop, onIsCustom: noop,
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

test("recommendation leaves capability and model selectors usable while restricting templates and mentions", () => {
  const value = setup()
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
    expect(value.state.model).not.toBe("seedream-5-lite")
    expect(value.state.enabled).toBe(true)
    value.setState("model", "seedream-5-lite")
    value.setState("menu", null)
    value.setState("enabled", false)
    expect(button(value.container, "风格模板").disabled).toBe(false)
    expect(value.container.querySelector(".studio-composer-icon-at")).not.toBeNull()
  } finally { value.dispose() }
})
