import { beforeEach, describe, expect, test } from "bun:test"
import { MemoryStore } from "@/memory/store"
import { parseActions } from "@/memory/extract"
import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import type { ProjectID } from "@/project/schema"

const projectID = "mem_test_project" as ProjectID
const otherID = "mem_test_other" as ProjectID
const budget = MemoryStore.DEFAULT_BUDGET_TOKENS

beforeEach(() => {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: "/tmp/mem-test", sandboxes: [] })
      .onConflictDoNothing()
      .run(),
  )
  MemoryStore.clear(projectID)
  MemoryStore.clear(otherID)
})

describe("memory store", () => {
  test("write then system exposes index block", () => {
    MemoryStore.write({
      projectID,
      actions: [
        {
          action: "create",
          type: "feedback",
          topic: "pnpm_preference",
          content: "只用 pnpm，禁止 npm",
          summary: "本仓库只用 pnpm",
        },
      ],
      budget,
    })
    const system = MemoryStore.system(projectID)
    expect(system).toHaveLength(1)
    expect(system[0]).toContain("<memory>")
    expect(system[0]).toContain("(feedback) pnpm_preference: 本仓库只用 pnpm")
  })

  test("same topic upserts instead of duplicating", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "user", topic: "role", content: "v1", summary: "第一版" }],
      budget,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "user", topic: "role", content: "v2", summary: "第二版" }],
      budget,
    })
    const rows = MemoryStore.list(projectID)
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe("v2")
  })

  test("delete action removes by topic", () => {
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "project", topic: "deadline", content: "x", summary: "y" },
        { action: "delete", topic: "deadline" },
      ],
      budget,
    })
    expect(MemoryStore.list(projectID)).toHaveLength(0)
  })

  test("system respects token budget", () => {
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "project", topic: "a", content: "a", summary: "x".repeat(100) },
        { action: "create", type: "project", topic: "b", content: "b", summary: "y".repeat(100) },
      ],
      budget: 10,
    })
    expect(MemoryStore.system(projectID, 10)).toHaveLength(0)
  })

  test("trim drops oldest unpinned entries beyond budget", () => {
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "project", topic: "first", content: "1", summary: "s".repeat(80) },
        { action: "create", type: "project", topic: "second", content: "2", summary: "s".repeat(80) },
        { action: "create", type: "project", topic: "third", content: "3", summary: "s".repeat(80) },
      ],
      budget: 30,
    })
    const topics = MemoryStore.list(projectID).map((row) => row.topic)
    expect(topics).toEqual(["third"])
  })

  test("entries are project scoped", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "user", topic: "scoped", content: "x", summary: "y" }],
      budget,
    })
    expect(MemoryStore.list(otherID)).toHaveLength(0)
    expect(MemoryStore.system(otherID)).toHaveLength(0)
  })
})

describe("parseActions", () => {
  test("parses bare json array", () => {
    const actions = parseActions(
      `[{"action":"create","type":"feedback","topic":"t","content":"c","summary":"s"}]`,
    )
    expect(actions).toEqual([{ action: "create", type: "feedback", topic: "t", content: "c", summary: "s" }])
  })

  test("parses fenced json", () => {
    const actions = parseActions(
      "```json\n[{\"type\":\"user\",\"topic\":\"t\",\"content\":\"c\",\"summary\":\"s\"}]\n```",
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe("create")
  })

  test("parses json embedded in prose", () => {
    const actions = parseActions('好的，结果如下：\n[{"type":"user","topic":"t","content":"c","summary":"s"}]\n以上就是全部。')
    expect(actions).toHaveLength(1)
  })

  test("delete action only needs topic", () => {
    const actions = parseActions(`[{"action":"delete","topic":"stale"}]`)
    expect(actions).toEqual([{ action: "delete", topic: "stale" }])
  })

  test("rejects garbage and invalid entries", () => {
    expect(parseActions("no json here")).toEqual([])
    expect(parseActions(`[{"topic":"","content":"c","summary":"s"}]`)).toEqual([])
    expect(parseActions(`[{"type":"bogus","topic":"t","content":"c","summary":"s"}]`)).toEqual([])
    expect(parseActions(`[{"type":"feedback","topic":"t","content":"","summary":""}]`)).toEqual([])
  })
})
