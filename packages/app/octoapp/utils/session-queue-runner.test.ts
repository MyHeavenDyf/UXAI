import { describe, expect, test } from "bun:test"
import { runDrainPass, type QueueRunnerAdapter } from "./session-queue-runner"

/**
 * SPEC-INS-027 runner 内核单测。测的是 level-triggered 对账逻辑（runDrainPass），
 * 用假 adapter 直接驱动，不依赖 Solid 调度时序。
 */
function makeAdapter(initial: Record<string, string[]>) {
  const buckets: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(initial)) buckets[k] = [...v]
  const busy = new Set<string>()
  const sent: Array<{ sid: string; item: string }> = []
  let sendImpl: (sid: string, item: string) => Promise<void> = async () => {}

  const adapter: QueueRunnerAdapter<string> = {
    buckets: () => buckets,
    isBusy: (sid) => busy.has(sid),
    shift: (sid) => {
      const q = buckets[sid]
      if (!q?.length) return undefined
      const [head, ...rest] = q
      if (rest.length) buckets[sid] = rest
      else delete buckets[sid] // 空桶删除，对齐 send-queue.updateSessionQueue
      return head
    },
    send: (sid, item) => {
      sent.push({ sid, item })
      return sendImpl(sid, item)
    },
  }
  return { adapter, buckets, busy, sent, setSend: (f: typeof sendImpl) => (sendImpl = f) }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("runDrainPass", () => {
  test("V1 idle + 非空队列 → drain 队首一条", () => {
    const h = makeAdapter({ s1: ["a", "b"] })
    runDrainPass(h.adapter, new Set())
    expect(h.sent).toEqual([{ sid: "s1", item: "a" }])
    expect(h.buckets.s1).toEqual(["b"]) // 队首已弹出
  })

  test("V2 busy 时不 drain；busy→idle 后 drain 下一条（链式）", () => {
    const h = makeAdapter({ s1: ["a", "b"] })
    const inflight = new Set<string>()

    runDrainPass(h.adapter, inflight) // 发 a
    expect(h.sent.map((x) => x.item)).toEqual(["a"])
    expect(inflight.has("s1")).toBe(true)

    h.busy.add("s1") // turn 开始
    runDrainPass(h.adapter, inflight) // busy → 不发，清 in-flight
    expect(h.sent.length).toBe(1)
    expect(inflight.has("s1")).toBe(false)

    h.busy.delete("s1") // 回 idle
    runDrainPass(h.adapter, inflight) // 发 b
    expect(h.sent.map((x) => x.item)).toEqual(["a", "b"])
  })

  test("V3 in-flight 守卫：已 dispatch 未转 busy 时，再对账不重复发同一条", () => {
    const h = makeAdapter({ s1: ["a", "b"] })
    const inflight = new Set<string>()

    runDrainPass(h.adapter, inflight) // 发 a，inflight={s1}
    // status 尚未转 busy，队列仍非空（b 在）；再来一次对账
    runDrainPass(h.adapter, inflight) // inflight.has(s1) && !busy → 跳过
    expect(h.sent.length).toBe(1)
    expect(h.buckets.s1).toEqual(["b"]) // b 未被提前弹出
  })

  test("V4 多 session 并存：各自独立 drain，互不串场（隔离）", () => {
    const h = makeAdapter({ s1: ["a"], s2: ["x"] })
    runDrainPass(h.adapter, new Set())
    expect(h.sent).toContainEqual({ sid: "s1", item: "a" })
    expect(h.sent).toContainEqual({ sid: "s2", item: "x" })
    expect(h.sent.length).toBe(2)
  })

  test("V5 send reject → 释放 in-flight、不吞后续、不死循环", async () => {
    const h = makeAdapter({ s1: ["a"] })
    h.setSend(async () => {
      throw new Error("boom")
    })
    const inflight = new Set<string>()

    runDrainPass(h.adapter, inflight) // 发 a（异步 reject）
    expect(inflight.has("s1")).toBe(true) // send 前已置位
    expect(h.sent.length).toBe(1)

    await tick() // 让 reject 处理器跑
    expect(inflight.has("s1")).toBe(false) // 守卫已释放
    expect(h.buckets.s1).toBeUndefined() // 失败项已消费、不自动重试（与既有行为一致）
  })

  test("空桶 / 空队列不触发发送", () => {
    const h = makeAdapter({})
    runDrainPass(h.adapter, new Set())
    expect(h.sent.length).toBe(0)
  })
})
