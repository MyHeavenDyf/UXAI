import { afterEach, describe, expect, test, vi } from "bun:test"
import { createPromptPersistence } from "./prompt-persistence"

afterEach(() => vi.useRealTimers())

function persistence() {
  const writes: { sessionId: string | undefined; doc: string }[] = []
  return {
    writes,
    ...createPromptPersistence<string>((sessionId, doc) => writes.push({ sessionId, doc })),
  }
}

describe("Insight 输入草稿持久化", () => {
  test("连续输入合并为一次写入最新草稿", () => {
    vi.useFakeTimers()
    const draft = persistence()
    for (const index of Array.from({ length: 100 }, (_, index) => index)) {
      draft.schedule("a", String(index))
      vi.advanceTimersByTime(10)
    }
    expect(draft.writes).toHaveLength(0)
    vi.advanceTimersByTime(289)
    expect(draft.writes).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(draft.writes).toEqual([{ sessionId: "a", doc: "99" }])
  })

  test("切会话立即写入原会话草稿，新建页和已有会话相互隔离", () => {
    vi.useFakeTimers()
    const draft = persistence()
    draft.schedule(undefined, "new conversation")
    draft.schedule("a", "session a")
    draft.schedule("b", "session b")
    expect(draft.writes).toEqual([{ sessionId: undefined, doc: "new conversation" }, { sessionId: "a", doc: "session a" }])
    vi.advanceTimersByTime(300)
    expect(draft.writes.at(-1)).toEqual({ sessionId: "b", doc: "session b" })
  })

  test("切页/卸载前 flush 保存最新草稿并取消延时写入", () => {
    vi.useFakeTimers()
    const draft = persistence()
    draft.schedule("a", "latest")
    draft.flush()
    draft.flush()
    vi.advanceTimersByTime(300)
    expect(draft.writes).toEqual([{ sessionId: "a", doc: "latest" }])
  })

  test("发送后的清空覆盖尚未写入的草稿，不会被旧定时器回填", () => {
    vi.useFakeTimers()
    const draft = persistence()
    draft.schedule("a", "many asset references")
    draft.schedule("a", "")
    draft.flush()
    vi.advanceTimersByTime(300)
    expect(draft.writes).toEqual([{ sessionId: "a", doc: "" }])
  })
})
