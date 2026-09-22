/**
 * 后台读盘比对竞态守卫测试。
 *
 * 场景:激活已有 tab 后异步 readFileBuffer,期间——
 *   1. 再次激活同 tab 发起第二次读盘,且两次乱序完成(较旧的晚回);
 *   2. 用户编辑 / agent 更新使 tab.content 在读盘期间变化。
 * 旧实现只检查「tab 是否还在」,较旧结果会 updateTabContent 覆盖较新内容。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/bg-compare-guard.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"
import { createBgCompareGuard } from "./bg-compare-guard"

describe("createBgCompareGuard", () => {
  test("单次发起、内容未变 → 可应用", () => {
    const g = createBgCompareGuard()
    const token = g.issue("a")
    expect(g.canApply("a", token, "orig", "orig")).toBe(true)
  })

  test("乱序完成:较旧的读盘在新读盘发起后完成 → 放弃(避免旧内容覆盖新内容)", () => {
    const g = createBgCompareGuard()
    const t1 = g.issue("a") // 第一次激活发起读盘
    const t2 = g.issue("a") // 第二次激活(更晚)又发起一次读盘
    // t1 较晚完成 —— 已有更新的 token,放弃
    expect(g.canApply("a", t1, "orig", "orig")).toBe(false)
    // t2 较早完成 —— 可应用
    expect(g.canApply("a", t2, "orig", "orig")).toBe(true)
  })

  test("读盘期间内容被外部改动(用户编辑 / agent 更新) → 放弃覆盖", () => {
    const g = createBgCompareGuard()
    const token = g.issue("a")
    // 期间 tab.content 已不再等于快照内容
    expect(g.canApply("a", token, "edited", "orig")).toBe(false)
  })

  test("更早完成的读盘已更新内容后,较旧读盘完成时被内容快照挡住", () => {
    const g = createBgCompareGuard()
    const t1 = g.issue("a")
    const t2 = g.issue("a")
    // t2 先完成并更新了内容(当前内容已变)
    expect(g.canApply("a", t2, "orig", "orig")).toBe(true)
    // 假设 t2 应用后内容变为 new —— t1 完成时当前内容 ≠ 快照 → 放弃
    expect(g.canApply("a", t1, "new", "orig")).toBe(false)
  })

  test("不同 tab 互不影响", () => {
    const g = createBgCompareGuard()
    const ta = g.issue("a")
    const tb = g.issue("b")
    const tb2 = g.issue("b")
    expect(g.canApply("a", ta, "x", "x")).toBe(true)
    // b 被更新的 token 取代,旧 token 失效;但 a 不受影响
    expect(g.canApply("b", tb, "y", "y")).toBe(false)
    expect(g.canApply("b", tb2, "y", "y")).toBe(true)
    expect(g.canApply("a", ta, "x", "x")).toBe(true)
  })
})
