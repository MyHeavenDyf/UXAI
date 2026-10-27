import { expect, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { createExpansionReview, expansionGenerationInput, type ExpansionReviews } from "./studio-prompt-expansion-review"
import type { StudioTurnData } from "./turns"
import type { StudioCapability } from "./types"
import { createRecommendationSettings, type RecommendationImageSettings } from "./studio-recommendation-settings"

// Use the application's Solid DOM compiler rather than Bun's React JSX transform.
const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-expansion-review-dom-test",
  setup(build) {
    build.onLoad({ filter: /studio-prompt-expansion-review-view\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid view could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { StudioPromptExpansionReviewView } = await import("./studio-prompt-expansion-review-view")

const turn: StudioTurnData = {
  id: "user",
  userText: "原始描述",
  assistantText: "扩写正文",
  recommendation: { kind: "result", status: "completed", assistantMessageID: "assistant", tags: ["柔光", "写实"] },
  inputImages: [{ id: "reference", url: ".octo/session/uploads/reference.webp" }],
  createdAt: 1,
  isLatest: true,
}

function setup(input = turn, options?: {
  capability?: StudioCapability
  last?: RecommendationImageSettings
  cached?: RecommendationImageSettings
}) {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      busy: false, canGenerate: true, capability: options?.capability ?? "image.generate",
      shared: {
        aspectRatio: options?.capability === "video.generate" ? "21:9" : "3:4",
        count: options?.capability === "video.generate" ? 1 : 4,
        customWidth: 0, customHeight: 0, isCustom: false,
      } as RecommendationImageSettings,
    })
    const [images, setImages] = createStore<{
      last?: RecommendationImageSettings
      entries: Record<string, RecommendationImageSettings>
    }>({ last: options?.last, entries: options?.cached ? { session: options.cached } : {} })
    const settings = createRecommendationSettings({
      key: () => "session", enabled: () => false, ready: () => true,
      imageActive: () => state.capability === "image.generate",
      lastImage: () => images.last, saveImage: (value) => setImages("last", value),
      entries: () => images.entries,
      save: (key, value) => setImages("entries", key, value),
      global: () => state.shared,
      setGlobal: (value) => setState("shared", value),
      fallback: () => ({ aspectRatio: "3:4", count: 4, customWidth: 0, customHeight: 0, isCustom: false }),
    })
    const [saved, setSaved] = createStore<{ entries: ExpansionReviews }>({ entries: {} })
    const review = createExpansionReview({
      key: () => "session", ready: () => true, turns: () => [input],
      entries: () => saved.entries,
      save: (key, id, value) => setSaved("entries", key, (entries) => ({ ...entries, [id]: value })),
    })
    const requests: ReturnType<typeof expansionGenerationInput>[] = []
    const container = document.createElement("div")
    document.body.append(container)
    const unmount = render(() => createComponent(StudioPromptExpansionReviewView, {
      turn: input,
      get text() { return review.text(input) },
      get editable() { return review.editable(input) },
      get busy() { return state.busy },
      get canGenerate() { return state.canGenerate },
      onInput: (text) => review.update(input, text),
      onChoose: (choice) => {
        const text = choice === "confirmed" ? review.text(input) : input.userText
        if (review.choose(input, choice)) requests.push(expansionGenerationInput(input, text, settings.image()))
      },
    }), container)
    return {
      container, state, setState, review, requests,
      dispose: () => { unmount(); container.remove(); dispose() },
    }
  })
}

function textarea(container: HTMLElement) {
  const node = container.querySelector("textarea")
  if (!node) throw new Error("Expansion textarea is missing")
  return node
}

function buttons(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button"))
}

test.each(["confirmed", "ignored"] as const)("%s freezes the real editor and removes both buttons", async (choice) => {
  const value = setup()
  try {
    await Bun.sleep(0)
    expect(textarea(value.container).readOnly).toBe(false)
    expect(buttons(value.container).map((button) => button.textContent?.trim()))
      .toEqual(["确认，按扩写内容生成", "忽略，使用原始描述"])
    textarea(value.container).value = "直接编辑后的扩写稿"
    textarea(value.container).dispatchEvent(new Event("input", { bubbles: true }))
    buttons(value.container)[choice === "confirmed" ? 0 : 1]!.click()
    expect(textarea(value.container).readOnly).toBe(true)
    expect(textarea(value.container).value).toBe("直接编辑后的扩写稿")
    expect(buttons(value.container)).toHaveLength(0)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0]?.effectivePrompt).toBe(choice === "confirmed" ? "直接编辑后的扩写稿" : "原始描述")
    expect(value.requests[0]?.referenceImages).toEqual([".octo/session/uploads/reference.webp"])
  } finally { value.dispose() }
})

test("ordinary task dismissal locks the editor and hides actions without generating from it", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    value.review.dismiss()
    expect(textarea(value.container).readOnly).toBe(true)
    expect(buttons(value.container)).toHaveLength(0)
    expect(value.requests).toHaveLength(0)
  } finally { value.dispose() }
})

test("blank edited text disables confirm but leaves ignore available", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    textarea(value.container).value = "  "
    textarea(value.container).dispatchEvent(new Event("input", { bubbles: true }))
    expect(buttons(value.container)[0]?.disabled).toBe(true)
    expect(buttons(value.container)[1]?.disabled).toBe(false)
    buttons(value.container)[0]!.click()
    expect(value.requests).toHaveLength(0)
    buttons(value.container)[1]!.click()
    expect(value.requests[0]?.prompt).toBe("原始描述")
  } finally { value.dispose() }
})

test("busy or unavailable image generation disables both actions", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    value.setState("busy", true)
    expect(buttons(value.container).every((button) => button.disabled)).toBe(true)
    value.setState("busy", false)
    value.setState("canGenerate", false)
    expect(buttons(value.container).every((button) => button.disabled)).toBe(true)
    expect(textarea(value.container).readOnly).toBe(false)
  } finally { value.dispose() }
})

test("text-only and referenced inputs use identical copy, with optional tags", async () => {
  const first = setup()
  const second = setup({ ...turn, inputImages: [], recommendation: { ...turn.recommendation!, tags: [] } })
  try {
    await Bun.sleep(0)
    expect(first.container.querySelectorAll(".studio-prompt-expansion-tags > span")).toHaveLength(2)
    expect(second.container.querySelector(".studio-prompt-expansion-tags")).toBeNull()
    expect(Array.from(first.container.querySelectorAll("p")).map((node) => node.textContent))
      .toEqual(Array.from(second.container.querySelectorAll("p")).map((node) => node.textContent))
    expect(first.container.textContent).toContain("已完成图文反推")
    expect(first.container.textContent).toContain("已基于您选中的图片风格进行扩写")
  } finally { first.dispose(); second.dispose() }
})


test.each(["confirmed", "ignored"] as const)("%s from video mode submits an image task using saved image settings", async (choice) => {
  const value = setup(turn, {
    capability: "video.generate",
    last: { aspectRatio: "2:3", count: 3, customWidth: 1024, customHeight: 1536, isCustom: true },
  })
  try {
    await Bun.sleep(0)
    expect(buttons(value.container)).toHaveLength(2)
    expect(buttons(value.container).every((button) => !button.disabled)).toBe(true)
    textarea(value.container).value = "视频模式下确认的扩写稿"
    textarea(value.container).dispatchEvent(new Event("input", { bubbles: true }))
    buttons(value.container)[choice === "confirmed" ? 0 : 1]!.click()
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0]).toMatchObject({
      capability: "image.generate",
      prompt: choice === "confirmed" ? "视频模式下确认的扩写稿" : "原始描述",
      aspectRatio: "2:3", count: 3, width: 1024, height: 1536,
      useRestoredInputs: true,
    })
    expect(value.state.capability).toBe("video.generate")
    expect(value.state.shared.aspectRatio).toBe("21:9")
    expect(buttons(value.container)).toHaveLength(0)
  } finally { value.dispose() }
})

test("video mode uses the recommendation session's image parameters ahead of the last image record", async () => {
  const value = setup(turn, {
    capability: "video.generate",
    last: { aspectRatio: "2:3", count: 3, customWidth: 1024, customHeight: 1536, isCustom: true },
    cached: { aspectRatio: "1:1", count: 2, customWidth: 0, customHeight: 0, isCustom: false },
  })
  try {
    await Bun.sleep(0)
    buttons(value.container)[0]!.click()
    expect(value.requests[0]).toMatchObject({ capability: "image.generate", aspectRatio: "1:1", count: 2 })
    expect(value.requests[0]).not.toHaveProperty("width")
    expect(value.requests[0]).not.toHaveProperty("height")
  } finally { value.dispose() }
})
