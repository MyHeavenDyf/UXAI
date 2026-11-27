import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import type { ProjectID } from "@/project/schema"

const projectID = "mem_test_project" as ProjectID
const memoryDir = path.join(Global.Path.data, "memory")

// preload 对整个测试进程设置了 OCTO_DISABLE_MEMORY=1
beforeEach(() => {
  delete process.env.OCTO_DISABLE_MEMORY
  fs.rmSync(path.join(memoryDir, projectID), { recursive: true, force: true })
})

afterEach(() => {
  process.env.OCTO_DISABLE_MEMORY = "1"
})

describe("memory worker architecture", () => {
  test("config surface: enabled + model + budget + interval", async () => {
    const { ConfigMemory } = await import("@/config/memory")
    expect(ConfigMemory.Info).toBeDefined()
  })

  test("persist: applyActions writes MEMORY.md and topics", async () => {
    const { persist } = await import("@/memory/persist")
    const actions = [
      { action: "create", type: "feedback", topic: "pnpm_preference", content: "只用 pnpm,禁止 npm", summary: "本仓库只用 pnpm" },
      { action: "create", type: "project", topic: "deploy_flow", content: "部署走内网 CI", summary: "部署走 CI" },
    ] as never[]
    const applied = persist.applyActions(projectID, actions, Date.now())
    expect(applied).toBe(2)
    const indexFile = path.join(memoryDir, projectID, "MEMORY.md")
    expect(fs.existsSync(indexFile)).toBe(true)
    const content = fs.readFileSync(indexFile, "utf8")
    expect(content).toContain("pnpm_preference")
    expect(content).toContain("deploy_flow")
    // 核心层(feedback)在索引行展开完整内容
    expect(content).toContain("只用 pnpm,禁止 npm")
    // 普通层(project)只有摘要
    expect(content).toContain("部署走 CI")
    expect(content).not.toContain("部署走内网 CI")
  })

  test("persist: dedup via update action", async () => {
    const { persist } = await import("@/memory/persist")
    const v1 = Date.now() - 5000
    const v2 = Date.now()
    persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "pref", content: "旧内容", summary: "旧" },
    ] as never[], v1)
    persist.applyActions(projectID, [
      { action: "update", type: "feedback", topic: "pref", content: "新内容", summary: "新" },
    ] as never[], v2)
    const indexFile = path.join(memoryDir, projectID, "MEMORY.md")
    const content = fs.readFileSync(indexFile, "utf8")
    expect(content).toContain("新内容")
    expect(content).not.toContain("旧内容")
  })

  test("persist: version guard prevents old batch overwriting new", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    persist.applyActions(projectID, [
      { action: "create", type: "project", topic: "ver", content: "new", summary: "s" },
    ] as never[], now)
    // 旧批次(更小版本)尝试覆盖 → 被挡;检查 topic 文件内容(索引只显示 project 的摘要)
    persist.applyActions(projectID, [
      { action: "update", type: "project", topic: "ver", content: "old", summary: "s" },
    ] as never[], now - 1000)
    const topicFile = path.join(memoryDir, projectID, "topics", "ver.md")
    expect(fs.readFileSync(topicFile, "utf8")).toContain("new")
    expect(fs.readFileSync(topicFile, "utf8")).not.toContain("old")
  })

  test("persist: delete and merge actions", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "a", content: "A内容", summary: "A" },
      { action: "create", type: "feedback", topic: "b", content: "B内容", summary: "B" },
    ] as never[], now)
    // merge b into a(feedback 在索引行展开完整内容)
    persist.applyActions(projectID, [
      { action: "merge", from: "b", into: "a", content: "合并后内容", summary: "合并" },
    ] as never[], now + 1000)
    const indexFile = path.join(memoryDir, projectID, "MEMORY.md")
    const content = fs.readFileSync(indexFile, "utf8")
    expect(content).toContain("合并后内容")
    expect(content).not.toContain("B内容")
    // b 的 topic 文件应被删除
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "b.md"))).toBe(false)
  })

  test("persist: cursor save/restore", async () => {
    const { persist } = await import("@/memory/persist")
    persist.writeCursor(projectID, "msg_test_001")
    expect(persist.readCursor(projectID)).toBe("msg_test_001")
  })

  test("store: system returns undefined when no index exists", async () => {
    const { MemoryStore } = await import("@/memory/store")
    const result = MemoryStore.system(projectID)
    expect(result).toBe("")
  })

  test("store: disabled checks", async () => {
    const { MemoryStore } = await import("@/memory/store")
    process.env.OCTO_DISABLE_MEMORY = "1"
    expect(MemoryStore.disabled({ enabled: true })).toBe(true)
    delete process.env.OCTO_DISABLE_MEMORY
    expect(MemoryStore.disabled(undefined)).toBe(false)
    expect(MemoryStore.disabled({ enabled: false })).toBe(true)
  })

  test("store: effectiveBudget dynamic scaling", async () => {
    const { MemoryStore } = await import("@/memory/store")
    expect(MemoryStore.effectiveBudget(2000, undefined)).toBe(2000)
    expect(MemoryStore.effectiveBudget(2000, 65536)).toBe(2000)
    expect(MemoryStore.effectiveBudget(2000, 8192)).toBe(1024)
    expect(MemoryStore.effectiveBudget(2000, 256)).toBe(300)
  })
})

describe("parseActions", () => {
  test("parses valid JSON with create/update/delete/merge", async () => {
    const { parseActions } = await import("@/memory/extract")
    const actions = parseActions(
      JSON.stringify([
        { action: "create", type: "feedback", topic: "t1", content: "c", summary: "s" },
        { action: "update", type: "user", topic: "t2", content: "c2", summary: "s2" },
        { action: "delete", topic: "t3" },
        { action: "merge", from: "t4", into: "t2", content: "merged", summary: "m" },
      ]),
    )
    expect(actions).toHaveLength(4)
    expect(actions[0].action).toBe("create")
    expect(actions[2].action).toBe("delete")
    expect(actions[3].action).toBe("merge")
  })

  test("rejects invalid entries", async () => {
    const { parseActions } = await import("@/memory/extract")
    expect(parseActions("not json")).toEqual([])
    expect(parseActions("[]")).toEqual([])
    expect(parseActions(undefined as never)).toEqual([])
    expect(parseActions(null as never)).toEqual([])
    expect(parseActions(
      JSON.stringify([{ action: "create", type: "bogus", topic: "t", content: "c", summary: "s" }]),
    )).toEqual([])
    expect(parseActions(
      JSON.stringify([{ action: "create", type: "feedback", topic: "Bad-Case", content: "c", summary: "s" }]),
    )).toEqual([])
  })

  test("caps at 10 actions", async () => {
    const { parseActions } = await import("@/memory/extract")
    const many = Array.from({ length: 15 }, (_, i) => ({
      action: "create", type: "project", topic: `t${i}`, content: "c", summary: "s",
    }))
    expect(parseActions(JSON.stringify(many))).toHaveLength(10)
  })
})
