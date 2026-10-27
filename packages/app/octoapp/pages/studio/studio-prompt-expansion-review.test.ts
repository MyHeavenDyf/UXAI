import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { makePersisted } from "@solid-primitives/storage"
import { createExpansionReview, expansionGenerationInput, type ExpansionReviews } from "./studio-prompt-expansion-review"
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
