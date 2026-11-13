import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { makePersisted } from "@solid-primitives/storage"
import { createExpansionReview, expansionGenerationInput, generateExpansion, type ExpansionReviews } from "./studio-prompt-expansion-review"
import { createRecommendationSettings, type RecommendationImageSettings } from "./studio-recommendation-settings"
import type { StudioTurnData } from "./turns"

const turn: StudioTurnData = {
  id: "user-1",
  userText: "原始描述",
  assistantText: "扩写正文",
  recommendation: { kind: "result", status: "completed", assistantMessageID: "assistant-1", tags: ["柔光"] },
  inputImages: [{ id: "image-1", url: ".octo/session/uploads/reference.webp" }],
  createdAt: 1,
  isLatest: true,
}

function setup(options?: { ready?: boolean; turns?: StudioTurnData[]; storage?: string }) {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      key: "server/account/project/session-a",
      ready: options?.ready ?? true,
      turns: options?.turns ?? [turn],
      resultID: "assistant-1",
    })
    const store = createStore<{ entries: ExpansionReviews }>({ entries: {} })
    const saved = options?.storage
      ? makePersisted(store, { name: options.storage, storage: sessionStorage })
      : store
    const review = createExpansionReview({
      key: () => state.key,
      ready: () => state.ready,
      turns: () => state.turns,
      resultID: () => state.resultID,
      entries: () => saved[0].entries,
      save: (key, id, value) => saved[1]("entries", key, (entries) => ({ ...entries, [id]: value })),
    })
    return { dispose, state, setState, saved, review }
  })
}

test("a synchronized result never overwrites an edited draft", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    expect(value.review.editable(turn)).toBe(true)
    value.review.update(turn, "编辑后的正文")
    value.setState("turns", [{ ...turn, assistantText: "服务器再次返回的正文" }])
    expect(value.review.text(turn)).toBe("编辑后的正文")
  } finally { value.dispose() }
})

test.each(["confirmed", "ignored"] as const)("%s consumes the choice once and freezes the draft", async (choice) => {
  const value = setup()
  try {
    await Bun.sleep(0)
    value.review.update(turn, "最后编辑稿")
    expect(value.review.choose(turn, choice)).toBe(true)
    expect(value.review.editable(turn)).toBe(false)
    expect(value.review.choose(turn, "confirmed")).toBe(false)
    value.review.update(turn, "不能写入")
    value.review.dismiss()
    expect(value.review.text(turn)).toBe("最后编辑稿")
    expect(value.saved[0].entries[value.state.key]?.["assistant-1"]?.status).toBe(choice)
  } finally { value.dispose() }
})

test.each([
  { from: "seedream-5-pro", to: "seedream-5-lite", width: 1280, height: 720 },
  { from: "seedream-5-lite", to: "seedream-5-pro", width: 3072, height: 3072 },
].flatMap((scenario) => (["confirmed", "ignored"] as const).map((choice) => ({ ...scenario, choice }))))(
  "invalid restored dimensions leave the expansion retryable after switching models in another session: %j",
  async (scenario) => {
    const value = setup()
    const controls = createRoot((dispose) => {
      const [state, setState] = createStore({
        session: "A",
        model: scenario.from,
        entries: {
          A: { aspectRatio: "1:1", count: 1, customWidth: scenario.width, customHeight: scenario.height, isCustom: true },
        } as Record<string, RecommendationImageSettings>,
        shared: { aspectRatio: "3:4", count: 1, customWidth: 0, customHeight: 0, isCustom: false } as RecommendationImageSettings,
      })
      const settings = createRecommendationSettings({
        key: () => state.session,
        enabled: () => true,
        entries: () => state.entries,
        ready: () => true,
        imageActive: () => true,
        lastImage: () => undefined,
        saveImage: () => {},
        fallback: () => state.shared,
        global: () => state.shared,
        setGlobal: (next) => setState("shared", next),
        save: (key, next) => setState("entries", key, next),
      })
      return { state, setState, settings, dispose }
    })
    try {
      await Bun.sleep(0)
      value.review.update(turn, "可重试的编辑稿")
      const key = value.state.key
      controls.setState("session", "B")
      value.setState("key", "session-b")
      controls.setState("model", scenario.to)
      controls.setState("session", "A")
      value.setState("key", key)
      expect(controls.settings.image().customWidth).toBe(scenario.width)
      expect(controls.settings.image().customHeight).toBe(scenario.height)

      const requests: unknown[] = []
      const notices: string[] = []
      const submit = () => generateExpansion({
        turn,
        choice: scenario.choice,
        ready: true,
        review: value.review,
        styleModel: controls.state.model,
        settings: controls.settings.image(),
        notify: (message) => { notices.push(message) },
        generate: async (request) => { requests.push(request) },
      })
      const capture = value.review.capture()
      await submit()
      expect(requests).toHaveLength(0)
      expect(notices).toEqual(["当前自定义尺寸不符合所选模型要求，请调整后重试。"])
      expect(value.review.editable(turn)).toBe(true)
      expect(value.review.text(turn)).toBe("可重试的编辑稿")
      expect(value.saved[0].entries[key]?.["assistant-1"]?.status).toBe("pending")
      expect(capture()).toBe(true)

      controls.settings.set("customWidth", 2048)
      controls.settings.set("customHeight", 2048)
      await submit()
      expect(requests).toEqual([expect.objectContaining({
        styleModel: scenario.to,
        prompt: scenario.choice === "confirmed" ? "可重试的编辑稿" : turn.userText,
        width: 2048,
        height: 2048,
        inputPolicy: "preserve",
      })])
      expect(value.saved[0].entries[key]?.["assistant-1"]?.status).toBe(scenario.choice)
      expect(value.review.editable(turn)).toBe(false)
      expect(notices).toHaveLength(1)
      await submit()
      expect(requests).toHaveLength(1)
    } finally {
      controls.dispose()
      value.dispose()
    }
  },
)

test("ordinary tasks dismiss the review without changing its edited text", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    value.review.update(turn, "未采用的编辑稿")
    const capture = value.review.capture()
    value.review.dismiss()
    expect(capture()).toBe(false)
    expect(value.review.editable(turn)).toBe(false)
    expect(value.review.text(turn)).toBe("未采用的编辑稿")
    expect(value.saved[0].entries[value.state.key]?.["assistant-1"]?.status).toBe("dismissed")
  } finally { value.dispose() }
})

test("a later ordinary message prevents historical expansions from reopening", async () => {
  const value = setup({ turns: [turn, { id: "user-2", userText: "普通生成", assistantText: "", createdAt: 2, isLatest: true }] })
  try {
    await Bun.sleep(0)
    expect(value.review.editable(turn)).toBe(false)
    expect(value.saved[0].entries[value.state.key]?.["assistant-1"]?.status).toBe("dismissed")
    value.setState("turns", [turn])
    expect(value.review.editable(turn)).toBe(false)
  } finally { value.dispose() }
})

test("a new turn immediately invalidates a pending review", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    value.setState("turns", [turn, { ...turn, id: "user-2", recommendation: { kind: "guide", status: "armed" }, createdAt: 2 }])
    expect(value.review.choose(turn, "confirmed")).toBe(false)
    expect(value.saved[0].entries[value.state.key]?.["assistant-1"]?.status).toBe("dismissed")
  } finally { value.dispose() }
})

test("a delayed history snapshot cannot reopen a result dismissed before it arrived", async () => {
  const value = setup({ ready: false, turns: [] })
  try {
    await Bun.sleep(0)
    expect(value.saved[0].entries[value.state.key]).toBeUndefined()
    value.review.dismiss()
    value.setState("turns", [turn])
    value.setState("ready", true)
    expect(value.review.editable(turn)).toBe(false)
    expect(value.review.text(turn)).toBe("扩写正文")
  } finally { value.dispose() }
})

test.each(["running", "cancelling", "failed", "cancelled"])("%s never creates a review", async (status) => {
  const value = setup({ turns: [{ ...turn, recommendation: { ...turn.recommendation!, status } }] })
  try {
    await Bun.sleep(0)
    expect(value.saved[0].entries[value.state.key]).toBeUndefined()
    expect(value.review.editable(value.state.turns[0]!)).toBe(false)
  } finally { value.dispose() }
})

test("session keys isolate drafts and invalidate async work even after navigating back", async () => {
  const value = setup()
  try {
    await Bun.sleep(0)
    value.review.update(turn, "会话 A 草稿")
    const capture = value.review.capture()
    value.setState("key", "other-server/account/project/session-b")
    value.review.update(turn, "会话 B 草稿")
    value.review.dismiss()
    expect(value.review.editable(turn)).toBe(false)
    value.setState("key", "server/account/project/session-a")
    expect(capture()).toBe(false)
    expect(value.review.editable(turn)).toBe(true)
    expect(value.review.text(turn)).toBe("会话 A 草稿")
  } finally { value.dispose() }
})

test.each(["pending", "confirmed", "ignored", "dismissed"] as const)("session storage restores %s after disposing and rebuilding the store", async (status) => {
  const key = `studio-review-test:${crypto.randomUUID()}`
  const first = setup({ storage: key })
  try {
    await Bun.sleep(0)
    first.review.update(turn, "刷新前编辑稿")
    if (status === "confirmed" || status === "ignored") first.review.choose(turn, status)
    if (status === "dismissed") first.review.dismiss()
    await Bun.sleep(0)
    expect(sessionStorage.getItem(key)).toContain("刷新前编辑稿")
  } finally { first.dispose() }
  const second = setup({ storage: key })
  try {
    await Bun.sleep(0)
    expect(second.review.text(turn)).toBe("刷新前编辑稿")
    expect(second.review.editable(turn)).toBe(status === "pending")
  } finally {
    second.dispose()
    sessionStorage.removeItem(key)
  }
})

test("generation inputs use this turn's references and bypass refinement without consuming composer drafts", () => {
  const confirmed = expansionGenerationInput(turn, "编辑后的正文")
  const ignored = expansionGenerationInput(turn, turn.userText)
  expect(confirmed.prompt).toBe("编辑后的正文")
  expect(confirmed.effectivePrompt).toBe(confirmed.prompt)
  expect(confirmed.refinedPrompt).toBe(confirmed.prompt)
  expect(ignored.prompt).toBe("原始描述")
  expect(ignored.referenceImages).toEqual([".octo/session/uploads/reference.webp"])
  expect(confirmed.extra.skipPromptRefine).toBe(true)
  expect(confirmed.extra.promptExpansionSource).toEqual({ assistantMessageID: "assistant-1" })
  expect(ignored.extra.promptExpansionSource).toEqual(confirmed.extra.promptExpansionSource)
  expect(confirmed.useRestoredInputs).toBe(true)
  expect(confirmed.mentionImages).toEqual({})
  expect(expansionGenerationInput({ ...turn, inputImages: [] }, "文字扩写").referenceImages).toEqual([])
})
