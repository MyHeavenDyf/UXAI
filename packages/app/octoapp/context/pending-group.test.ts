import { describe, expect, test } from "bun:test"
import {
  setPendingGroup,
  consumePendingGroup,
  clearPendingGroup,
  clearStalePendingGroup,
} from "./pending-group"
import type { MakeGroup } from "@/hooks/use-make-groups"

const g = (id: string): MakeGroup => ({ id, name: id, created_at: 0 })
const projA = "/home/user/projA"
const projB = "/home/user/projB"

// pending state is module-level and persists across tests in the same file, so
// clean the namespace before each case to avoid cross-test bleed.
function reset() {
  clearPendingGroup("make")
  clearPendingGroup("insight")
}

describe("pending group store", () => {
  test("same project + existing group → assigns the group", () => {
    reset()
    setPendingGroup("make", "g1", projA)
    expect(consumePendingGroup("make", projA, [g("g1"), g("g2")])).toBe("g1")
  })

  test("consume is one-shot (second consume returns null)", () => {
    reset()
    setPendingGroup("make", "g1", projA)
    consumePendingGroup("make", projA, [g("g1")])
    expect(consumePendingGroup("make", projA, [g("g1")])).toBeNull()
  })

  test("no pending entry → null", () => {
    reset()
    expect(consumePendingGroup("make", projA, [g("g1")])).toBeNull()
  })

  test("group removed between set and consume → null (no dangling assignment)", () => {
    reset()
    setPendingGroup("make", "g1", projA)
    expect(consumePendingGroup("make", projA, [g("g2")])).toBeNull()
  })

  test("namespaces are independent", () => {
    reset()
    setPendingGroup("make", "gm", projA)
    setPendingGroup("insight", "gi", projA)
    expect(consumePendingGroup("make", projA, [g("gm")])).toBe("gm")
    expect(consumePendingGroup("insight", projA, [g("gi")])).toBe("gi")
  })
})

describe("pending group cross-project leak (P1)", () => {
  test("pending set in project A is rejected when consumed in project B", () => {
    reset()
    // 1. In project A, click "新建对话" inside group gA.
    setPendingGroup("make", "gA", projA)
    // 2-3. Switch to project B and create+send a session there. project B's group
    //      list (even if it happened to contain an id "gA") must not receive the
    //      assignment because the origin directory (projA) != current (projB).
    expect(consumePendingGroup("make", projB, [g("gA")])).toBeNull()
    // and the stale entry is gone (consumed = one-shot), so it can't leak later
    expect(consumePendingGroup("make", projB, [g("gA")])).toBeNull()
  })

  test("clearStalePendingGroup drops entries from another directory on switch", () => {
    reset()
    setPendingGroup("make", "gA", projA)
    // project switch A → B
    clearStalePendingGroup("make", projB)
    // back in the same project B (or A) there is nothing to apply
    expect(consumePendingGroup("make", projB, [g("gA")])).toBeNull()
  })

  test("clearStalePendingGroup retains entries that match the current directory", () => {
    reset()
    setPendingGroup("make", "gA", projA)
    // still in project A → must not be cleared
    clearStalePendingGroup("make", projA)
    expect(consumePendingGroup("make", projA, [g("gA")])).toBe("gA")
  })

  test("explicit clearPendingGroup discards a pending entry", () => {
    reset()
    setPendingGroup("make", "gA", projA)
    clearPendingGroup("make")
    expect(consumePendingGroup("make", projA, [g("gA")])).toBeNull()
  })

  test("round-trip A→B→A: switch to B clears, returning to A finds nothing", () => {
    reset()
    setPendingGroup("make", "gA", projA)
    // switch A → B
    clearStalePendingGroup("make", projB)
    // switch B → A: the entry was already dropped, no stale assignment leaks back
    clearStalePendingGroup("make", projA)
    expect(consumePendingGroup("make", projA, [g("gA")])).toBeNull()
  })
})
