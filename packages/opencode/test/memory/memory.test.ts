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
    const applied = await persist.applyActions(projectID, actions, Date.now())
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
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "pref", content: "旧内容", summary: "旧" },
    ] as never[], v1)
    await persist.applyActions(projectID, [
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
    await persist.applyActions(projectID, [
      { action: "create", type: "project", topic: "ver", content: "new", summary: "s" },
    ] as never[], now)
    // 旧批次(更小版本)尝试覆盖 → 被挡;检查 topic 文件内容(索引只显示 project 的摘要)
    await persist.applyActions(projectID, [
      { action: "update", type: "project", topic: "ver", content: "old", summary: "s" },
    ] as never[], now - 1000)
    const topicFile = path.join(memoryDir, projectID, "topics", "ver.md")
    expect(fs.readFileSync(topicFile, "utf8")).toContain("new")
    expect(fs.readFileSync(topicFile, "utf8")).not.toContain("old")
  })

  test("persist: delete and merge actions", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "a", content: "A内容", summary: "A" },
      { action: "create", type: "feedback", topic: "b", content: "B内容", summary: "B" },
    ] as never[], now)
    // merge b into a(feedback 在索引行展开完整内容)
    await persist.applyActions(projectID, [
      { action: "merge", from: "b", into: "a", content: "合并后内容", summary: "合并" },
    ] as never[], now + 1000)
    const indexFile = path.join(memoryDir, projectID, "MEMORY.md")
    const content = fs.readFileSync(indexFile, "utf8")
    expect(content).toContain("合并后内容")
    expect(content).not.toContain("B内容")
    // b 的 topic 文件应被删除
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "b.md"))).toBe(false)
  })

  test("persist: cursor save/restore per session", async () => {
    const { persist } = await import("@/memory/persist")
    persist.writeCursor(projectID, "ses_a", "msg_test_001")
    persist.writeCursor(projectID, "ses_b", "msg_test_002")
    expect(persist.readCursor(projectID, "ses_a")).toBe("msg_test_001")
    expect(persist.readCursor(projectID, "ses_b")).toBe("msg_test_002")
    // 同 session 重写覆盖自己
    persist.writeCursor(projectID, "ses_a", "msg_test_003")
    expect(persist.readCursor(projectID, "ses_a")).toBe("msg_test_003")
    // 不同 session 互不影响
    expect(persist.readCursor(projectID, "ses_b")).toBe("msg_test_002")
    expect(persist.readCursor(projectID, "ses_missing")).toBeUndefined()
  })

  test("persist: tombstone blocks late old-batch resurrection", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "old_pref", content: "旧偏好", summary: "旧" },
    ] as never[], now - 10_000)
    // 删除(墓碑版本 ≈ now)
    expect(await persist.applyActions(projectID, [
      { action: "delete", topic: "old_pref" },
    ] as never[], now)).toBe(1)
    // 迟到的旧批次(version < 墓碑版本)create 复活 → 拒绝
    expect(await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "old_pref", content: "复活尝试", summary: "复活" },
    ] as never[], now - 5_000)).toBe(0)
    // update 同样被拒
    expect(await persist.applyActions(projectID, [
      { action: "update", type: "feedback", topic: "old_pref", content: "复活尝试2", summary: "复活" },
    ] as never[], now - 5_000)).toBe(0)
    // 确实没有落盘
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "old_pref.md"))).toBe(false)
    // 更新批次(version > 墓碑版本)可以合法重建,并解除墓碑
    expect(await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "old_pref", content: "重新确认的偏好", summary: "新" },
    ] as never[], now + 60_000)).toBe(1)
    expect(fs.readFileSync(path.join(memoryDir, projectID, "topics", "old_pref.md"), "utf8")).toContain("重新确认的偏好")
  })

  test("persist: clear() buries topics so late extractions cannot resurrect", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "cleared", content: "待清除", summary: "s" },
    ] as never[], now)
    persist.clear(projectID)
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "cleared.md"))).toBe(false)
    expect(fs.existsSync(path.join(memoryDir, projectID, "MEMORY.md"))).toBe(false)
    // 清除后,迟到的旧批次(version 早于墓碑)create 复活 → 拒绝
    expect(await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "cleared", content: "复活尝试", summary: "x" },
    ] as never[], now - 1000)).toBe(0)
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "cleared.md"))).toBe(false)
    // 全新的批次可以重新开始积累
    expect(await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "cleared", content: "重新积累", summary: "x" },
    ] as never[], Date.now() + 60_000)).toBe(1)
  })

  test("persist: delete guarded by version (old batch cannot delete newer memory)", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "project", topic: "keep", content: "新记忆", summary: "s" },
    ] as never[], now)
    // 旧批次 delete → 被拒
    expect(await persist.applyActions(projectID, [
      { action: "delete", topic: "keep" },
    ] as never[], now - 1000)).toBe(0)
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "keep.md"))).toBe(true)
    // 新批次 delete → 生效
    expect(await persist.applyActions(projectID, [
      { action: "delete", topic: "keep" },
    ] as never[], now + 1000)).toBe(1)
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "keep.md"))).toBe(false)
  })

  test("persist: merge guards — self-merge, missing source, stale version", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "a", content: "A内容", summary: "A" },
      { action: "create", type: "feedback", topic: "b", content: "B内容", summary: "B" },
    ] as never[], now)
    // 自合并禁止:两条原样保留
    expect(await persist.applyActions(projectID, [
      { action: "merge", from: "a", into: "a", content: "自合并", summary: "x" },
    ] as never[], now + 1000)).toBe(0)
    expect(fs.readFileSync(path.join(memoryDir, projectID, "topics", "a.md"), "utf8")).toContain("A内容")
    // 源不存在(from 已被删除)→ 整个 merge 拒绝,不得借机覆盖 into
    await persist.applyActions(projectID, [{ action: "delete", topic: "b" }] as never[], now + 2000)
    expect(await persist.applyActions(projectID, [
      { action: "merge", from: "b", into: "a", content: "幽灵合并", summary: "x" },
    ] as never[], now + 3000)).toBe(0)
    expect(fs.readFileSync(path.join(memoryDir, projectID, "topics", "a.md"), "utf8")).toContain("A内容")
    // 旧批次 merge(版本低于 into 当前版本)→ 拒绝
    expect(await persist.applyActions(projectID, [
      { action: "merge", from: "a", into: "a2", content: "x", summary: "x" },
    ] as never[], now - 5000)).toBe(0)
  })

  test("persist: merge checks source.version too (old batch cannot merge away newer source)", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "src_new", content: "较新的源", summary: "s" },
    ] as never[], now)
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "tgt_old", content: "较旧的目标", summary: "t" },
    ] as never[], now - 10_000)
    // 旧批次(version 早于 src_new 的版本)试图把更新的 src_new 合并走 → 拒绝
    expect(await persist.applyActions(projectID, [
      { action: "merge", from: "src_new", into: "tgt_old", content: "偷走新源", summary: "x" },
    ] as never[], now - 5_000)).toBe(0)
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "src_new.md"))).toBe(true)
    expect(fs.readFileSync(path.join(memoryDir, projectID, "topics", "src_new.md"), "utf8")).toContain("较新的源")
  })

  test("persist: merge enforces content length caps", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "m_len_a", content: "A", summary: "A" },
      { action: "create", type: "feedback", topic: "m_len_b", content: "B", summary: "B" },
    ] as never[], now)
    // merge 内容超上限(绕过 parseActions 的直接调用)→ persist 层拒绝,两条保留
    expect(await persist.applyActions(projectID, [
      { action: "merge", from: "m_len_b", into: "m_len_a", content: "x".repeat(2001), summary: "x" },
    ] as never[], now + 1000)).toBe(0)
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "m_len_b.md"))).toBe(true)
  })

  test("persist: sensitive content rejected for create/update/merge", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    expect(await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "secret_create", content: "token sk-abc12345defg678", summary: "x" },
    ] as never[], now)).toBe(0)
    expect(await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "ok_topic", content: "正常内容", summary: "x" },
    ] as never[], now)).toBe(1)
    expect(await persist.applyActions(projectID, [
      { action: "update", type: "feedback", topic: "ok_topic", content: "api_key: abc1234567xyz", summary: "x" },
    ] as never[], now + 1000)).toBe(0)
    // merge 带敏感内容同样拒绝
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "sec_m1", content: "A", summary: "A" },
      { action: "create", type: "feedback", topic: "sec_m2", content: "B", summary: "B" },
    ] as never[], now + 2000)
    expect(await persist.applyActions(projectID, [
      { action: "merge", from: "sec_m2", into: "sec_m1", content: "Bearer aabbccdd11223344", summary: "x" },
    ] as never[], now + 3000)).toBe(0)
    // 敏感操作无落盘
    expect(fs.existsSync(path.join(memoryDir, projectID, "topics", "secret_create.md"))).toBe(false)
    expect(fs.readFileSync(path.join(memoryDir, projectID, "topics", "ok_topic.md"), "utf8")).toContain("正常内容")
  })

  test("persist: isSensitive / redactSecrets helpers", async () => {
    const { persist } = await import("@/memory/persist")
    expect(persist.isSensitive("sk-abc12345defg678")).toBe(true)
    expect(persist.isSensitive("password: hunter20945")).toBe(true)
    expect(persist.isSensitive("本项目使用 pnpm 管理依赖")).toBe(false)
    const redacted = persist.redactSecrets("密钥是 sk-abc12345defg678,长串是 aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ")
    expect(redacted).not.toContain("sk-abc12345defg678")
    expect(redacted).toContain("[REDACTED]")
  })

  test("persist: existingDigest lists topics for the extraction model", async () => {
    const { persist } = await import("@/memory/persist")
    const now = Date.now()
    await persist.applyActions(projectID, [
      { action: "create", type: "feedback", topic: "digest_a", content: "完整内容A", summary: "A" },
    ] as never[], now)
    const digest = persist.existingDigest(projectID)
    expect(digest).toContain("digest_a")
    expect(digest).toContain("完整内容A")
    // 无记忆时返回 undefined
    expect(persist.existingDigest(("digest_empty_" + Date.now()) as never)).toBeUndefined()
    // 超长截断
    await persist.applyActions(projectID, Array.from({ length: 30 }, (_, i) => ({
      action: "create", type: "project", topic: `digest_long_${i}`, content: `x`.repeat(200), summary: `s${i}`,
    })) as never[], now + 1000)
    const truncated = persist.existingDigest(projectID, 1000)!
    expect(truncated.length).toBeLessThanOrEqual(1100)
    expect(truncated).toContain("已截断")
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
    const parsed = parseActions(
      JSON.stringify([
        { action: "create", type: "feedback", topic: "t1", content: "c", summary: "s" },
        { action: "update", type: "user", topic: "t2", content: "c2", summary: "s2" },
        { action: "delete", topic: "t3" },
        { action: "merge", from: "t4", into: "t2", content: "merged", summary: "m" },
      ]),
    )
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.actions).toHaveLength(4)
    expect(parsed.actions[0].action).toBe("create")
    expect(parsed.actions[2].action).toBe("delete")
    expect(parsed.actions[3].action).toBe("merge")
    expect(parsed.skipped).toBe(0)
  })

  test("distinguishes parse errors from legal empty arrays", async () => {
    const { parseActions } = await import("@/memory/extract")
    // 无 JSON 数组 → 解析失败(游标应保留)
    expect(parseActions("not json").status).toBe("parse-error")
    expect(parseActions(undefined as never).status).toBe("parse-error")
    expect(parseActions(null as never).status).toBe("parse-error")
    expect(parseActions("oops 我忘了输出 JSON").status).toBe("parse-error")
    // 合法空数组 → ok(游标应推进)
    const empty = parseActions("[]")
    expect(empty.status).toBe("ok")
    if (empty.status === "ok") expect(empty.actions).toHaveLength(0)
  })

  test("invalid entries are counted as skipped, not silently truncated", async () => {
    const { parseActions } = await import("@/memory/extract")
    const parsed = parseActions(
      JSON.stringify([
        { action: "create", type: "bogus", topic: "t", content: "c", summary: "s" },
        { action: "create", type: "feedback", topic: "Bad-Case", content: "c", summary: "s" },
        { action: "create", type: "feedback", topic: "ok_one", content: "c", summary: "s" },
        { action: "what", topic: "x" },
      ]),
    )
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.actions).toHaveLength(1)
    expect(parsed.skipped).toBe(3)
  })

  test("caps at 10 actions and counts the overflow as skipped", async () => {
    const { parseActions } = await import("@/memory/extract")
    const many = Array.from({ length: 15 }, (_, i) => ({
      action: "create", type: "project", topic: `t${i}`, content: "c", summary: "s",
    }))
    const parsed = parseActions(JSON.stringify(many))
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.actions).toHaveLength(10)
    expect(parsed.skipped).toBe(5)
  })

  test("rejects oversized merge content at parse level", async () => {
    const { parseActions } = await import("@/memory/extract")
    const parsed = parseActions(
      JSON.stringify([
        { action: "merge", from: "a", into: "b", content: "x".repeat(2001), summary: "s" },
        { action: "merge", from: "a", into: "a", content: "self", summary: "s" },
      ]),
    )
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.actions).toHaveLength(0)
    expect(parsed.skipped).toBe(2)
  })
})
