import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import fs from "node:fs"
import path from "node:path"
import type { ModelMessage } from "ai"
import { Global } from "@opencode-ai/core/global"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { MemoryTable } from "@/memory/memory.sql"
import { MemoryTombstoneTable } from "@/memory/tombstone.sql"
import { MemoryStore } from "@/memory/store"
import { MemoryExtract, parseActions } from "@/memory/extract"
import { MemoryDebug } from "@/memory/debug"
import {
  MemoryReadTool,
  MemorySearchTool,
  buildReadOutput,
  collectVisible,
  available as memoryToolsAvailable,
} from "@/tool/memory"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import type { ConfigMemory } from "@/config/memory"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import type { MessageV2 } from "@/session/message-v2"
import * as Session from "@/session/session"
import { Truncate } from "@/tool/truncate"
import * as Tool from "@/tool/tool"
import type { ProjectID } from "@/project/schema"

const projectID = "mem_test_project" as ProjectID
const otherID = "mem_test_other" as ProjectID
const budget = MemoryStore.DEFAULT_BUDGET_TOKENS

const projectPath = (id: string) => path.join(Global.Path.data, "memory", id)
const indexFile = (id: string) => path.join(projectPath(id), "MEMORY.md")
const tombstoneFile = (id: string) => path.join(projectPath(id), ".tombstones.json")

// 裸删目录而非 MemoryStore.clear():clear() 会写 .cleared 清除版本,
// 其"拒绝更旧批次"的语义由专属用例覆盖,其余用例需要自由的合成版本号。
const wipe = (id: string) => fs.rmSync(projectPath(id), { recursive: true, force: true })

// preload 对整个测试进程设置了 OCTO_DISABLE_MEMORY=1,存储层测试需要显式开启并在结束后恢复
beforeEach(() => {
  delete process.env.OCTO_DISABLE_MEMORY
  wipe(projectID)
  wipe(otherID)
})

afterEach(() => {
  process.env.OCTO_DISABLE_MEMORY = "1"
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
    // 核心层级(feedback)索引行直接展开完整 content,声明参考数据与 memory_read 用法
    expect(system[0]).toContain("(feedback) pnpm_preference: 只用 pnpm，禁止 npm")
    expect(system[0]).toContain("REFERENCE DATA")
    expect(system[0]).toContain("memory_read")
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

  test("older extraction batch never overwrites newer memory", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "ver", content: "new", summary: "s" }],
      budget,
      version: 2000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "ver", content: "old", summary: "s" }],
      budget,
      version: 1000,
    })
    expect(MemoryStore.list(projectID)[0].content).toBe("new")
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "ver", content: "newer", summary: "s" }],
      budget,
      version: 3000,
    })
    expect(MemoryStore.list(projectID)[0].content).toBe("newer")
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

  test("system respects token budget at view time without touching storage", () => {
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "project", topic: "a", content: "a", summary: "x".repeat(100) },
        { action: "create", type: "project", topic: "b", content: "b", summary: "y".repeat(100) },
      ],
      budget,
    })
    expect(MemoryStore.system(projectID, 10)).toHaveLength(0)
    expect(MemoryStore.list(projectID)).toHaveLength(2)
  })

  test("small-context injection budget never evicts stored memories", () => {
    MemoryStore.write({
      projectID,
      actions: Array.from({ length: 30 }, (_, i) => ({
        action: "create" as const,
        type: "project" as const,
        topic: `note_${i}`,
        content: `c${i}`,
        summary: "s".repeat(80),
      })),
      budget,
    })
    expect(MemoryStore.list(projectID)).toHaveLength(30)
    // 4K 窗口 → 注入预算收缩到 512,只看到部分条目
    const small = MemoryStore.system(projectID, MemoryStore.effectiveBudget(2000, 4096))
    const smallLines = small[0].split("\n").filter((line) => line.startsWith("- (")).length
    expect(smallLines).toBeGreaterThan(0)
    expect(smallLines).toBeLessThan(30)
    // 但持久化记忆一条不少:切回大上下文模型全部回来
    expect(MemoryStore.list(projectID)).toHaveLength(30)
    const full = MemoryStore.system(projectID, 2000)
    expect(full[0].split("\n").filter((line) => line.startsWith("- (")).length).toBe(30)
  })

  test("single oversized entry skips itself without blocking shorter ones", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "short_a", content: "a", summary: "ok" }],
      budget,
      version: 3000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "long_b", content: "b", summary: "y".repeat(100) }],
      budget,
      version: 2000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "short_c", content: "c", summary: "fine" }],
      budget,
      version: 1000,
    })
    const system = MemoryStore.system(projectID, 15)
    expect(system).toHaveLength(1)
    expect(system[0]).toContain("short_a")
    expect(system[0]).toContain("short_c")
    expect(system[0]).not.toContain("long_b")
  })

  test("core tier injects full content, normal tier only the summary", () => {
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "user", topic: "core_pref", content: "核心完整内容", summary: "核心摘要" },
        { action: "create", type: "project", topic: "normal_note", content: "普通完整内容", summary: "普通摘要" },
      ],
      budget,
    })
    const system = MemoryStore.system(projectID)
    expect(system[0]).toContain("(user) core_pref: 核心完整内容")
    expect(system[0]).not.toContain("核心摘要")
    expect(system[0]).toContain("(project) normal_note: 普通摘要")
    expect(system[0]).not.toContain("普通完整内容")
  })

  test("core entries are injected first when budget is tight", () => {
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "project", topic: "normal_old", content: "n", summary: "s".repeat(100) },
        { action: "create", type: "feedback", topic: "core_new", content: "核心内容", summary: "s" },
      ],
      budget,
    })
    const system = MemoryStore.system(projectID, 40)
    expect(system[0]).toContain("core_new")
    expect(system[0]).not.toContain("normal_old")
  })

  test("trim drops oldest entries beyond the storage budget", () => {
    // 显式版本号保证淘汰顺序确定(文件系统 readdir 顺序不保证)
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "first", content: "1", summary: "s".repeat(80) }],
      budget: 30,
      version: 1000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "second", content: "2", summary: "s".repeat(80) }],
      budget: 30,
      version: 2000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "third", content: "3", summary: "s".repeat(80) }],
      budget: 30,
      version: 3000,
    })
    const topics = MemoryStore.list(projectID).map((row) => row.topic)
    expect(topics).toEqual(["third"])
  })

  test("entries are project scoped by directory", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "user", topic: "scoped", content: "x", summary: "y" }],
      budget,
    })
    expect(MemoryStore.list(otherID)).toHaveLength(0)
    expect(MemoryStore.system(otherID)).toHaveLength(0)
  })

  test("manual edits to MEMORY.md apply to the next request", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "editable", content: "c", summary: "原始摘要" }],
      budget,
    })
    expect(MemoryStore.system(projectID)[0]).toContain("原始摘要")
    // 人工把索引行改成新摘要:下次注入立即生效,无需任何管理面
    const file = indexFile(projectID)
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("原始摘要", "手工改过的摘要"))
    expect(MemoryStore.system(projectID)[0]).toContain("手工改过的摘要")
  })
})

describe("memory switch", () => {
  test("OCTO_DISABLE_MEMORY hard-disables regardless of config", () => {
    process.env.OCTO_DISABLE_MEMORY = "1"
    expect(MemoryStore.disabled({ enabled: true })).toBe(true)
    expect(MemoryStore.disabled(undefined)).toBe(true)
    delete process.env.OCTO_DISABLE_MEMORY
    expect(MemoryStore.disabled({ enabled: true })).toBe(false)
    expect(MemoryStore.disabled(undefined)).toBe(false)
    expect(MemoryStore.disabled({ enabled: false })).toBe(true)
  })

  test("write returns false while OCTO_DISABLE_MEMORY is set", () => {
    process.env.OCTO_DISABLE_MEMORY = "1"
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "user", topic: "blocked", content: "x", summary: "y" }],
        budget,
      }),
    ).toBe(false)
    delete process.env.OCTO_DISABLE_MEMORY
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "user", topic: "allowed", content: "x", summary: "y" }],
        budget,
      }),
    ).toBe(true)
    expect(MemoryStore.list(projectID)).toHaveLength(1)
  })
})

describe("effectiveBudget", () => {
  test("scales down for small context windows, floors at minimum", () => {
    expect(MemoryStore.effectiveBudget(2000, undefined)).toBe(2000)
    expect(MemoryStore.effectiveBudget(2000, 65536)).toBe(2000)
    expect(MemoryStore.effectiveBudget(2000, 262144)).toBe(2000)
    expect(MemoryStore.effectiveBudget(5000, 65536)).toBe(5000)
    expect(MemoryStore.effectiveBudget(2000, 8192)).toBe(1024)
    expect(MemoryStore.effectiveBudget(2000, 4096)).toBe(512)
    expect(MemoryStore.effectiveBudget(2000, 2048)).toBe(MemoryStore.MIN_BUDGET_TOKENS)
    expect(MemoryStore.effectiveBudget(2000, 256)).toBe(MemoryStore.MIN_BUDGET_TOKENS)
  })
})

describe("memory_read on-demand loading", () => {
  const entry = (topic: string, content: string, summary = "s") => ({
    action: "create" as const,
    type: "project" as const,
    topic,
    content,
    summary,
  })

  test("entriesByTopics resolves exact topic names within the project", () => {
    MemoryStore.write({ projectID, actions: [entry("a", "内容A"), entry("b", "内容B")], budget })
    expect(MemoryStore.entriesByTopics(projectID, ["a"])).toHaveLength(1)
    expect(MemoryStore.entriesByTopics(projectID, ["a"])[0].content).toBe("内容A")
    expect(MemoryStore.entriesByTopics(projectID, ["b"])[0].topic).toBe("b")
  })

  test("entriesByTopics is strictly project scoped and rejects invalid topics", () => {
    MemoryStore.write({ projectID, actions: [entry("a", "内容A")], budget })
    expect(MemoryStore.entriesByTopics(otherID, ["a"])).toHaveLength(0)
    // 路径穿越/大小写等非法 topic 名一律查不到(文件名白名单)
    expect(MemoryStore.entriesByTopics(projectID, ["../evil", "UPPER", "no-such"])).toHaveLength(0)
  })

  test("entriesByTopics dedupes topics and resolves every unique one (no silent cap)", () => {
    MemoryStore.write({
      projectID,
      actions: Array.from({ length: 12 }, (_, i) => entry(`topic_${i}`, `内容${i}`)),
      budget,
    })
    const topics = Array.from({ length: 12 }, (_, i) => `topic_${i}`)
    // 去重后逐条解析;批量上限在工具层显式报告,store 层不做静默截断
    expect(MemoryStore.entriesByTopics(projectID, [...topics, ...topics])).toHaveLength(12)
    expect(MemoryStore.entriesByTopics(projectID, [])).toHaveLength(0)
  })
})

describe("memory tombstone (file-backed)", () => {
  const entry = (topic: string) => ({
    action: "create" as const,
    type: "project" as const,
    topic,
    content: "c",
    summary: "s",
  })
  const tombstones = () => {
    const file = tombstoneFile(projectID)
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, number>) : {}
  }

  test("old delete cannot delete newer memory", () => {
    MemoryStore.write({ projectID, actions: [entry("t")], budget, version: 1000 })
    expect(MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "t" }], budget, version: 500 })).toBe(true)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "t")).toBe(true)
  })

  test("deleted memory cannot be resurrected by older batch; newer batch can revive", () => {
    MemoryStore.write({ projectID, actions: [entry("t")], budget, version: 1000 })
    expect(MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "t" }], budget, version: 2000 })).toBe(true)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    // 墓碑 2000:旧批次(1500)的 create 不得复活
    expect(MemoryStore.write({ projectID, actions: [entry("t")], budget, version: 1500 })).toBe(true)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    // 更新批次(3000)合法复活,墓碑清理
    expect(MemoryStore.write({ projectID, actions: [entry("t")], budget, version: 3000 })).toBe(true)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "t")).toBe(true)
    expect(tombstones()["t"]).toBeUndefined()
  })

  test("old delete cannot overwrite a newer tombstone", () => {
    MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "gone" }], budget, version: 2000 })
    MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "gone" }], budget, version: 900 })
    expect(tombstones()["gone"]).toBe(2000)
  })

  test("tombstone from deleting an absent topic blocks older creates", () => {
    MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "ghost" }], budget, version: 2000 })
    expect(MemoryStore.write({ projectID, actions: [entry("ghost")], budget, version: 1500 })).toBe(true)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    expect(MemoryStore.write({ projectID, actions: [entry("ghost")], budget, version: 2500 })).toBe(true)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "ghost")).toBe(true)
  })
})

describe("cursor ordering: advance only after successful write", () => {
  test("parseResult distinguishes invalid JSON from valid empty array", () => {
    expect(MemoryExtract.parseResult("这不是 JSON")).toEqual({ valid: false, actions: [] })
    expect(MemoryExtract.parseResult("[broken json")).toEqual({ valid: false, actions: [] })
    expect(MemoryExtract.parseResult("null")).toEqual({ valid: false, actions: [] })
    expect(MemoryExtract.parseResult("[]")).toEqual({ valid: true, actions: [] })
    const result = MemoryExtract.parseResult(
      `[{"action":"create","type":"feedback","topic":"t","content":"c","summary":"s"}]`,
    )
    expect(result.valid).toBe(true)
    expect(result.actions).toHaveLength(1)
  })

  test("write returns false when the memory directory is unusable", () => {
    // 用普通文件占住项目目录路径 → mkdir 失败 → write 降级返回 false
    fs.mkdirSync(path.join(Global.Path.data, "memory"), { recursive: true })
    fs.writeFileSync(projectPath("mem_broken_project"), "not a directory")
    expect(
      MemoryStore.write({
        projectID: "mem_broken_project" as ProjectID,
        actions: [{ action: "create", type: "user", topic: "x", content: "c", summary: "s" }],
        budget,
      }),
    ).toBe(false)
    fs.rmSync(projectPath("mem_broken_project"))
  })
})

describe("parseActions strict validation", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    type: "feedback",
    topic: "t",
    content: "c",
    summary: "s",
    ...overrides,
  })

  test("parses bare and fenced json", () => {
    expect(parseActions(`[{"action":"create","type":"feedback","topic":"t","content":"c","summary":"s"}]`)).toEqual([
      { action: "create", type: "feedback", topic: "t", content: "c", summary: "s" },
    ])
    expect(parseActions("```json\n" + JSON.stringify([entry()]) + "\n```")).toHaveLength(1)
    expect(parseActions("好的：\n" + JSON.stringify([entry()]) + "\n以上。")).toHaveLength(1)
  })

  test("delete only needs a valid topic", () => {
    expect(parseActions(`[{"action":"delete","topic":"stale"}]`)).toEqual([{ action: "delete", topic: "stale" }])
  })

  test("rejects invalid topics", () => {
    expect(parseActions(`[${JSON.stringify(entry({ topic: "Bad-Topic" }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ topic: "中文" }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ topic: "a".repeat(65) }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ topic: "" }))}]`)).toEqual([])
  })

  test("rejects oversize or empty fields", () => {
    expect(parseActions(`[${JSON.stringify(entry({ summary: "s".repeat(201) }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ content: "c".repeat(2001) }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ content: "", summary: "" }))}]`)).toEqual([])
  })

  test("rejects entries containing secrets", () => {
    expect(parseActions(`[${JSON.stringify(entry({ content: "key is sk-abcdefgh12345678" }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ summary: "password: hunter2secret" }))}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify(entry({ type: "bogus" }))}]`)).toEqual([])
  })

  test("caps batch sizes: max 3 deletes and 20 creates", () => {
    const deletes = Array.from({ length: 6 }, (_, i) => ({ action: "delete", topic: `d${i}` }))
    const parsed = parseActions(JSON.stringify(deletes))
    expect(parsed).toHaveLength(3)
    expect(parsed.every((item) => item.action === "delete")).toBe(true)

    const creates = Array.from({ length: 30 }, (_, i) => entry({ topic: `topic_${i}` }))
    expect(parseActions(JSON.stringify(creates))).toHaveLength(20)
  })

  test("rejects garbage", () => {
    expect(parseActions("no json here")).toEqual([])
    expect(parseActions("[]")).toEqual([])
    expect(parseActions("null")).toEqual([])
  })

  test("rejects unknown action values", () => {
    expect(parseActions(`[${JSON.stringify({ action: "bogus", topic: "t", content: "c", summary: "s" })}]`)).toEqual([])
    expect(parseActions(`[${JSON.stringify({ action: 123, topic: "t", content: "c", summary: "s" })}]`)).toEqual([])
    // 缺省 action 视为 create,合法
    expect(parseActions(`[${JSON.stringify({ type: "feedback", topic: "t", content: "c", summary: "s" })}]`)).toHaveLength(1)
  })
})

describe("MemoryExtract cursor and throttle", () => {
  const reply = `[{"action":"create","type":"feedback","topic":"cursor_test","content":"c","summary":"s"}]`

  const msg = (id: string, role: "user" | "assistant", text: string): MessageV2.WithParts =>
    ({
      info: {
        id,
        role,
        sessionID: "ses_x",
        agent: "build",
        model: { providerID: "t", modelID: "m" },
        time: { created: Date.now() },
      },
      parts: [{ type: "text", text, synthetic: false }],
    }) as unknown as MessageV2.WithParts

  const session = (id: string, proj: string = projectID) =>
    ({ id, projectID: proj, parentID: undefined }) as unknown as Session.Info

  const fakeConfig = (memory?: ConfigMemory.Info) =>
    ({ get: () => Effect.succeed({ memory }) }) as unknown as Config.Interface

  const fakeAgents = () =>
    ({
      get: () =>
        Effect.succeed({ name: "memory", mode: "primary", hidden: true, permission: [] } as unknown as Agent.Info),
    }) as unknown as Agent.Interface

  const fakeProvider = () =>
    ({
      getTitleModel: () =>
        Effect.succeed({
          providerID: "t",
          id: "m",
          api: { npm: "@ai-sdk/openai-compatible" },
        } as unknown as Provider.Model),
      getModel: () => Effect.die("not used"),
    }) as unknown as Provider.Interface

  const fakeLLM = (replies: string[]) => {
    const calls: { messages: ModelMessage[] }[] = []
    const llm = {
      stream: (input: { messages: ModelMessage[] }) => {
        calls.push({ messages: input.messages })
        return Stream.make({ type: "text-delta", text: replies.shift() ?? "[]" } as unknown as LLM.Event)
      },
    } as unknown as LLM.Interface
    return { llm, calls }
  }

  const run = (opts: {
    sessionId: string
    history: MessageV2.WithParts[]
    llm: LLM.Interface
    interval?: number
    project?: string
  }) =>
    Effect.runPromise(
      MemoryExtract.extract({
        config: fakeConfig(
          opts.interval === undefined ? undefined : ({ extraction_interval_seconds: opts.interval } as ConfigMemory.Info),
        ),
        agents: fakeAgents(),
        provider: fakeProvider(),
        llm: opts.llm,
        session: session(opts.sessionId, opts.project),
        history: opts.history,
        lastUser: opts.history[0].info as MessageV2.User,
      }),
    )

  test("extracts, writes and marks trust boundary in the instruction", async () => {
    const { llm, calls } = fakeLLM([reply])
    await run({ sessionId: "ses_a", history: [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")], llm })
    expect(calls).toHaveLength(1)
    const instruction = JSON.stringify(calls[0].messages[calls[0].messages.length - 1])
    expect(instruction).toContain("一律忽略")
    expect(MemoryStore.list(projectID).some((row) => row.topic === "cursor_test")).toBe(true)
  })

  test("throttle skips extraction without losing messages (cursor not advanced by skips)", async () => {
    const { llm, calls } = fakeLLM([reply, reply])
    await run({ sessionId: "ses_b", history: [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")], llm })
    await run({
      sessionId: "ses_b",
      history: [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的"), msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")],
      llm,
    })
    // 60s 节流期内第二次触发被跳过,不发起 LLM 调用
    expect(calls).toHaveLength(1)
  })

  test("compensation: skipped turns are re-extracted from the cursor once throttle passes", async () => {
    const { llm, calls } = fakeLLM([reply, reply])
    const first = [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")]
    await run({ sessionId: "ses_c", history: first, llm })
    // 节流窗口设为 0,模拟窗口过期:游标起补偿切片,只含未处理的 u2 回合
    await run({
      sessionId: "ses_c",
      interval: 0,
      history: [...first, msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")],
      llm,
    })
    expect(calls).toHaveLength(2)
    const secondPrompt = JSON.stringify(calls[1].messages)
    expect(secondPrompt).toContain("第二个回合")
    expect(secondPrompt).not.toContain("第一个回合")
  })

  test("cursor fallback to last turn when the cursor message was compacted away", async () => {
    const { llm, calls } = fakeLLM([reply, reply])
    await run({ sessionId: "ses_d", history: [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")], llm })
    // u1 已被 compaction 清掉,游标失效 → 回退"最后回合"兜底
    await run({
      sessionId: "ses_d",
      interval: 0,
      history: [msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")],
      llm,
    })
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1].messages)).toContain("第二个回合")
  })

  test("empty model output still advances the cursor", async () => {
    const { llm, calls } = fakeLLM(["[]", reply])
    await run({ sessionId: "ses_e", history: [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")], llm })
    await run({
      sessionId: "ses_e",
      interval: 0,
      history: [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的"), msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")],
      llm,
    })
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1].messages)).not.toContain("第一个回合")
  })

  test("no new real user message since cursor skips extraction entirely", async () => {
    const { llm, calls } = fakeLLM([reply, reply])
    const history = [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")]
    await run({ sessionId: "ses_f", history, llm })
    // 自动续跑场景:游标命中但之后只有 assistant 续写,没有新的真实用户消息 → 不重复提取
    await run({
      sessionId: "ses_f",
      interval: 0,
      history: [...history, msg("a2", "assistant", "继续下一步")],
      llm,
    })
    expect(calls).toHaveLength(1)
  })

  test("invalid model output does not advance the cursor: failed turns are retried", async () => {
    const { llm, calls } = fakeLLM([reply, "这不是JSON", reply])
    const first = [msg("u1", "user", "第一个回合"), msg("a1", "assistant", "好的")]
    const second = [msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")]
    await run({ sessionId: "ses_g", history: first, llm })
    // 非法 JSON:本批游标必须回退,不允许把该批消息标记为已处理
    await run({ sessionId: "ses_g", interval: 0, history: [...first, ...second], llm })
    expect(calls).toHaveLength(2)
    await run({
      sessionId: "ses_g",
      interval: 0,
      history: [...first, ...second, msg("u3", "user", "第三个回合"), msg("a3", "assistant", "好")],
      llm,
    })
    expect(calls).toHaveLength(3)
    const retried = JSON.stringify(calls[2].messages)
    expect(retried).toContain("第二个回合")
    expect(retried).not.toContain("第一个回合")
  })

  test("failed write does not advance the cursor: turns are retried", async () => {
    // 用普通文件占住项目目录 → 写入必失败,游标不得推进
    fs.mkdirSync(path.join(Global.Path.data, "memory"), { recursive: true })
    fs.writeFileSync(projectPath("mem_fk_project"), "not a directory")
    try {
      const { llm, calls } = fakeLLM([reply, reply])
      const history = [
        msg("u0", "user", "第零个回合"),
        msg("a0", "assistant", "嗯"),
        msg("u1", "user", "第一个回合"),
        msg("a1", "assistant", "好的"),
      ]
      await run({ sessionId: "ses_h", history, llm, project: "mem_fk_project" })
      expect(calls).toHaveLength(1)
      await run({
        sessionId: "ses_h",
        interval: 0,
        history: [...history, msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")],
        llm,
        project: "mem_fk_project",
      })
      expect(calls).toHaveLength(2)
      const retried = JSON.stringify(calls[1].messages)
      expect(retried).toContain("第一个回合")
    } finally {
      fs.rmSync(projectPath("mem_fk_project"))
    }
  })
})

describe("buildReadOutput", () => {
  const row = (topic: string, content: string, version = 1) =>
    ({ topic, type: "project", content, summary: "s", version, time_updated: version }) as unknown as MemoryStore.Row

  test("returns full content for fresh topics", () => {
    const result = buildReadOutput({ rows: [row("t_a", "内容A")], visible: new Map(), maxTokens: 1000 })
    expect(result.returned).toBe(1)
    expect(result.output).toContain("内容A")
    expect(result.returnedTopics).toEqual(["t_a"])
  })

  test("unchanged memories already visible in context get a hint, not a re-send", () => {
    const visible = new Map([["t_a", 1]])
    const result = buildReadOutput({ rows: [row("t_a", "内容A", 1)], visible, maxTokens: 1000 })
    expect(result.returned).toBe(0)
    expect(result.output).toContain("内容未变化")
    expect(result.output).not.toContain("内容A")
  })

  test("updated memories are re-read even if the topic was loaded before", () => {
    const visible = new Map([["t_a", 1]])
    const result = buildReadOutput({ rows: [row("t_a", "新内容", 2)], visible, maxTokens: 1000 })
    expect(result.returned).toBe(1)
    expect(result.output).toContain("新内容")
    expect(result.output).toContain("已返回最新内容")
  })

  test("memories whose old output was compacted away become readable again", () => {
    const result = buildReadOutput({ rows: [row("t_a", "内容A", 1)], visible: new Map(), maxTokens: 1000 })
    expect(result.returned).toBe(1)
    expect(result.output).toContain("内容A")
  })

  test("unknown topics degrade to a not-found message", () => {
    const result = buildReadOutput({ rows: [], visible: new Map(), maxTokens: 1000 })
    expect(result.returned).toBe(0)
    expect(result.output).toContain("未找到匹配的记忆")
  })

  test("caps single-return size and reports the remainder", () => {
    const rows = [row("t_a", "x".repeat(600)), row("t_b", "y".repeat(600)), row("t_c", "z".repeat(600))]
    const result = buildReadOutput({ rows, visible: new Map(), maxTokens: 400 })
    expect(result.returned).toBeLessThan(3)
    expect(result.tokens).toBeLessThanOrEqual(400)
    expect(result.output).toContain("剩余")
    expect(result.returnedTopics).not.toContain("t_c")
  })

  test("a single oversized entry is truncated instead of blocking the whole read", () => {
    const oversized = row("t_big", "b".repeat(8000))
    const small = row("t_small", "s")
    const result = buildReadOutput({ rows: [oversized, small], visible: new Map(), maxTokens: 1000 })
    expect(result.returned).toBe(1)
    expect(result.output).toContain("[内容超长已截断]")
    expect(result.output).toContain("剩余 1 条")
    const next = buildReadOutput({ rows: [small], visible: new Map(), maxTokens: 1000 })
    expect(next.returned).toBe(1)
  })
})

describe("collectVisible (compaction-aware dedup)", () => {
  const part = (topic: string, v: number, compacted?: number) =>
    ({
      type: "tool",
      tool: "memory_read",
      state: { status: "completed", time: { compacted }, metadata: { entries: [{ topic, v }] } },
    }) as unknown as MessageV2.Part
  const message = (...parts: MessageV2.Part[]) =>
    ({ info: { id: "msg_x", role: "assistant" }, parts }) as unknown as MessageV2.WithParts

  test("collects topics from live memory_read outputs", () => {
    const visible = collectVisible([message(part("t_a", 1), part("t_b", 2))])
    expect(visible.get("t_a")).toBe(1)
    expect(visible.get("t_b")).toBe(2)
  })

  test("skips outputs cleared by prune/compaction so they can be re-read", () => {
    const visible = collectVisible([message(part("t_a", 1, Date.now()))])
    expect(visible.has("t_a")).toBe(false)
  })

  test("ignores non-memory_read tools and malformed metadata", () => {
    const junk = {
      type: "tool",
      tool: "bash",
      state: { status: "completed", time: {}, metadata: { entries: [{ topic: "t_a", v: 1 }] } },
    } as unknown as MessageV2.Part
    expect(collectVisible([message(junk)]).size).toBe(0)
    expect(collectVisible([]).size).toBe(0)
  })
})

describe("memory tools execute (unified switch + isolation)", () => {
  const sessionInfo = { id: "ses_tool_1", projectID, parentID: undefined } as unknown as Session.Info
  const fakeConfig = (memory?: ConfigMemory.Info) =>
    ({ get: () => Effect.succeed({ memory }) }) as unknown as Config.Interface
  const fakeSessions = (info?: Session.Info) =>
    ({
      get: () => (info ? Effect.succeed(info) : Effect.fail(new Error("no session"))),
    }) as unknown as Session.Interface
  const fakeTruncate = () =>
    ({
      cleanup: () => Effect.void,
      write: (text: string) => Effect.succeed(text),
      output: (text: string) => Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 51200 }),
    }) as unknown as Truncate.Interface
  const fakeAgents = () =>
    ({
      get: () => Effect.succeed({ name: "build", mode: "primary" } as unknown as Agent.Info),
    }) as unknown as Agent.Interface
  const ctx = (messages: MessageV2.WithParts[] = []) =>
    ({
      sessionID: sessionInfo.id,
      messages,
      agent: "build",
      abort: new AbortController().signal,
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }) as unknown as Tool.Context
  // Tool.define 固定追加 Truncate/Agent 依赖,与 Config/Session 一并注入
  const toolServices = (cfg?: ConfigMemory.Info) =>
    Layer.mergeAll(
      Layer.succeed(Config.Service, fakeConfig(cfg)),
      Layer.succeed(Session.Service, fakeSessions(sessionInfo)),
      Layer.succeed(Truncate.Service, fakeTruncate()),
      Layer.succeed(Agent.Service, fakeAgents()),
    )
  const runRead = (params: { topics: string[] }, cfg?: ConfigMemory.Info, messages: MessageV2.WithParts[] = []) =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const def = yield* Tool.init(yield* MemoryReadTool)
          return yield* def.execute(params, ctx(messages))
        }),
        toolServices(cfg),
      ),
    )
  const runSearch = (params: { query?: string; offset?: number }, cfg?: ConfigMemory.Info) =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const def = yield* Tool.init(yield* MemorySearchTool)
          return yield* def.execute(params, ctx())
        }),
        toolServices(cfg),
      ),
    )

  test("refuses to read when the memory feature is disabled", async () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "t", content: "c", summary: "s" }],
      budget,
    })
    const result = await runRead({ topics: ["t"] }, { enabled: false })
    expect(result.output).toContain("记忆功能当前已关闭")
    expect(result.metadata.returned).toBe(0)
  })

  test("reads seeded memories and reports unmatched and over-batch topics explicitly", async () => {
    MemoryStore.write({
      projectID,
      actions: Array.from({ length: 10 }, (_, i) => ({
        action: "create" as const,
        type: "project" as const,
        topic: `tool_topic_${i}`,
        content: `工具读取内容${i}`,
        summary: `摘要${i}`,
      })),
      budget,
    })
    const result = await runRead({
      topics: [...Array.from({ length: 7 }, (_, i) => `tool_topic_${i}`), "ghost"],
    })
    // 7 个真实 topic + 1 个不存在的,恰好达单批上限:7 条返回 + 明确报告未匹配
    expect(result.metadata.returned).toBe(7)
    expect(result.output).toContain("1 个 topic 未匹配")
    const over = await runRead({ topics: Array.from({ length: 12 }, (_, i) => `tool_topic_${i % 10}`) })
    expect(over.output).toContain("已忽略多余的 2 个")
  })

  test("search finds memories beyond the resident index, with paging", async () => {
    MemoryStore.write({
      projectID,
      actions: Array.from({ length: 15 }, (_, i) => ({
        action: "create" as const,
        type: "project" as const,
        topic: `deploy_note_${i}`,
        content: `内容${i}`,
        summary: `部署摘要${i}`,
      })),
      budget,
    })
    const hit = await runSearch({ query: "deploy_note_3" })
    expect(hit.output).toContain("deploy_note_3")
    expect(hit.output).toContain("memory_read")
    // 空查询 → 最近一页(10 条),offset 翻页可见剩余
    const page1 = await runSearch({})
    expect(page1.metadata.returned).toBe(10)
    const page2 = await runSearch({ offset: 10 })
    expect(page2.metadata.returned).toBe(5)
    const miss = await runSearch({ query: "不存在的关键词xyz" })
    expect(miss.output).toContain("未检索到匹配")
    const disabled = await runSearch({ query: "deploy" }, { enabled: false })
    expect(disabled.output).toContain("记忆功能当前已关闭")
  })
})

describe("searchRows", () => {
  const row = (topic: string, summary: string) => ({ topic, summary, type: "project" }) as unknown as MemoryStore.Row

  test("matches topic and summary case-insensitively, pages via offset", () => {
    const rows = [row("pnpm_preference", "包管理"), row("NPM_Ban", "禁用"), row("other", "无关")]
    expect(MemoryStore.searchRows(rows, "pnpm", 10)).toHaveLength(1)
    expect(MemoryStore.searchRows(rows, "npm", 10)).toHaveLength(2)
    expect(MemoryStore.searchRows(rows, "包管理", 10)).toHaveLength(1)
    expect(MemoryStore.searchRows(rows, "", 2)).toHaveLength(2)
    expect(MemoryStore.searchRows(rows, "", 2, 2)).toHaveLength(1)
    expect(MemoryStore.searchRows(rows, "zzz", 10)).toHaveLength(0)
  })
})

describe("memory tools availability (registration scope)", () => {
  test("aligns with injection rules: unified switch + primary non-hidden agents", () => {
    const primary = { name: "octo_ai", mode: "primary", hidden: false }
    const subagent = { name: "explore", mode: "subagent", hidden: false }
    const hidden = { name: "title", mode: "primary", hidden: true }
    expect(memoryToolsAvailable(primary, undefined)).toBe(true)
    expect(memoryToolsAvailable(subagent, undefined)).toBe(false)
    expect(memoryToolsAvailable(hidden, undefined)).toBe(false)
    expect(memoryToolsAvailable(primary, { enabled: false })).toBe(false)
    process.env.OCTO_DISABLE_MEMORY = "1"
    expect(memoryToolsAvailable(primary, { enabled: true })).toBe(false)
    delete process.env.OCTO_DISABLE_MEMORY
    expect(memoryToolsAvailable(primary, { enabled: true })).toBe(true)
  })
})

describe("containsSecret", () => {
  test("detects common credential patterns", () => {
    expect(MemoryStore.containsSecret("sk-abcdefgh12345678")).toBe(true)
    expect(MemoryStore.containsSecret("Bearer eyJhbGciOiJIUzI1NiJ9")).toBe(true)
    expect(MemoryStore.containsSecret("api_key = abc123xyz789")).toBe(true)
    expect(MemoryStore.containsSecret("the user prefers pnpm in this repo")).toBe(false)
  })
})

describe("tier ordering (injection vs eviction)", () => {
  test("core memories win injection order even when older", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "normal_new", content: "n", summary: "新普通" }],
      budget,
      version: 9000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "feedback", topic: "core_old", content: "旧核心", summary: "旧核心摘要" }],
      budget,
      version: 1000,
    })
    // 注入优先:核心层在前,层内版本倒序——不因普通记忆版本更新而被排到核心前面
    const rows = MemoryStore.list(projectID)
    expect(rows.map((row) => row.topic)).toEqual(["core_old", "normal_new"])
    // MEMORY.md 视图与注入块同样核心在前
    expect(fs.readFileSync(indexFile(projectID), "utf8")).toMatch(/core_old.*\n.*normal_new/)
    const block = MemoryStore.system(projectID, 2000)[0]
    expect(block.indexOf("core_old")).toBeLessThan(block.indexOf("normal_new"))
  })

  test("trim evicts normal entries first even when they are newer", () => {
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "feedback", topic: "core_old", content: "核心", summary: "s" }],
      budget,
      version: 1000,
    })
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "normal_new", content: "n", summary: "y".repeat(80) }],
      budget,
      version: 9000,
    })
    // 存储预算 40:先淘汰普通层(尽管更新),核心层保留
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "trigger", content: "t", summary: "z".repeat(80) }],
      budget: 40,
      version: 9500,
    })
    const topics = MemoryStore.list(projectID).map((row) => row.topic)
    expect(topics).toContain("core_old")
    expect(topics).toContain("trigger")
    expect(topics).not.toContain("normal_new")
  })
})

describe("manual topic file edits", () => {
  test("flow into injection and re-read detection, and resist older batches", () => {
    const base = Date.now() - 100_000
    MemoryStore.write({
      projectID,
      actions: [
        { action: "create", type: "feedback", topic: "hand_edited", content: "原始内容", summary: "原始摘要" },
      ],
      budget,
      version: base,
    })
    expect(MemoryStore.system(projectID)[0]).toContain("原始内容")
    // 人工编辑 topics/<topic>.md 的内容(frontmatter 不动)
    const file = path.join(projectPath(projectID), "topics", "hand_edited.md")
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("原始内容", "手工改过的内容"))
    // 1) 注入行立即反映人工编辑:文件当前值优先于索引行文本
    expect(MemoryStore.system(projectID)[0]).toContain("手工改过的内容")
    // 2) memory_read 版本检测感知变化:mtime 推高有效版本 → 重新读取返回新内容
    const row = MemoryStore.entriesByTopics(projectID, ["hand_edited"])[0]
    expect(row.manual).toBe(true)
    expect(row.version).toBeGreaterThan(base)
    const result = buildReadOutput({ rows: [row], visible: new Map([["hand_edited", base]]), maxTokens: 1000 })
    expect(result.output).toContain("手工改过的内容")
    expect(result.output).toContain("已返回最新内容")
    // 3) 更旧的提取批次不得覆盖人工编辑
    expect(
      MemoryStore.write({
        projectID,
        actions: [
          { action: "create", type: "feedback", topic: "hand_edited", content: "旧批次内容", summary: "s" },
        ],
        budget,
        version: base - 1,
      }),
    ).toBe(true)
    expect(MemoryStore.entriesByTopics(projectID, ["hand_edited"])[0].content).toContain("手工改过的内容")
  })
})

describe("project write lock", () => {
  test("stale lock is stolen and no lock file remains after write", () => {
    fs.mkdirSync(projectPath(projectID), { recursive: true })
    const lock = path.join(projectPath(projectID), ".lock")
    // 模拟占用者崩溃留下的陈旧锁(mtime 远超保留期)
    fs.writeFileSync(lock, "99999")
    const stale = new Date(Date.now() - 120_000)
    fs.utimesSync(lock, stale, stale)
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "project", topic: "locked", content: "c", summary: "s" }],
        budget,
      }),
    ).toBe(true)
    expect(fs.existsSync(lock)).toBe(false)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "locked")).toBe(true)
  })
})

describe("clear epoch and remove tombstone", () => {
  test("clear rejects older in-flight batches and accepts fresh ones", () => {
    const old = Date.now() - 60_000
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "project", topic: "before_clear", content: "c", summary: "s" }],
        budget,
        version: old,
      }),
    ).toBe(true)
    MemoryStore.clear(projectID)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    // 清除前启动的异步批次(更旧版本)整体拒绝,不复活已清记忆
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "project", topic: "before_clear", content: "c", summary: "s" }],
        budget,
        version: old,
      }),
    ).toBe(false)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    // 清除后的新批次正常写入
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "project", topic: "after_clear", content: "c", summary: "s" }],
        budget,
        version: Date.now(),
      }),
    ).toBe(true)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "after_clear")).toBe(true)
  })

  test("remove writes a tombstone blocking older batches", () => {
    const base = Date.now() - 60_000
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "project", topic: "doomed", content: "c", summary: "s" }],
      budget,
      version: base,
    })
    MemoryStore.remove("doomed", projectID)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    // 墓碑版本 = 条目删除时的有效版本:更旧的批次复活被挡
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "project", topic: "doomed", content: "resurrect", summary: "s" }],
        budget,
        version: base - 1000,
      }),
    ).toBe(true)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    expect(JSON.parse(fs.readFileSync(tombstoneFile(projectID), "utf8"))["doomed"]).toBe(base)
    // 更新的批次可以合法重建,墓碑随之清理
    expect(
      MemoryStore.write({
        projectID,
        actions: [{ action: "create", type: "project", topic: "doomed", content: "new", summary: "s" }],
        budget,
        version: Date.now(),
      }),
    ).toBe(true)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "doomed")).toBe(true)
  })
})

describe("sqlite to markdown migration", () => {
  const legacy = "mem_legacy_project" as ProjectID

  beforeEach(() => {
    wipe(legacy)
    Database.use((db) => db.delete(MemoryTable).run())
    Database.use((db) => db.delete(MemoryTombstoneTable).run())
  })

  test("migrates legacy rows once, idempotently, and never resurrects after clear", () => {
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({ id: legacy, worktree: "/tmp/legacy", sandboxes: [] })
        .onConflictDoNothing()
        .run(),
    )
    Database.use((db) =>
      db
        .insert(MemoryTable)
        .values([
          {
            id: "legacy-a",
            project_id: legacy,
            type: "feedback",
            topic: "legacy_core",
            content: "旧核心内容",
            summary: "旧核心摘要",
            source_session_id: null,
            pinned: 0,
            time_created: 1000,
            time_updated: 2000,
          },
          {
            id: "legacy-b",
            project_id: legacy,
            type: "project",
            topic: "legacy_note",
            content: "旧普通内容",
            summary: "旧普通摘要",
            source_session_id: null,
            pinned: 0,
            time_created: 1000,
            time_updated: 3000,
          },
        ])
        .run(),
    )
    Database.use((db) =>
      db.insert(MemoryTombstoneTable).values({ project_id: legacy, topic: "legacy_gone", time_deleted: 4000 }).run(),
    )

    // 首次访问触发一次性迁移:内容/摘要/版本迁入文件,核心层排注入首位
    const rows = MemoryStore.list(legacy)
    expect(rows.some((row) => row.topic === "legacy_core" && row.content === "旧核心内容")).toBe(true)
    expect(rows.some((row) => row.topic === "legacy_note" && row.version === 3000)).toBe(true)
    expect(rows[0].topic).toBe("legacy_core")
    expect(fs.existsSync(indexFile(legacy))).toBe(true)
    // 墓碑同步迁移
    expect(JSON.parse(fs.readFileSync(tombstoneFile(legacy), "utf8"))["legacy_gone"]).toBe(4000)
    // 幂等:重复访问不重复迁移
    expect(MemoryStore.list(legacy)).toHaveLength(2)
    // clear 后 .cleared 抑制再迁移,旧 SQL 数据不回灌
    MemoryStore.clear(legacy)
    expect(MemoryStore.list(legacy)).toHaveLength(0)
  })
})

describe("memory debug isolation", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "memory-dbg-test-"))
  const dumps = () =>
    fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((s) => fs.readdirSync(path.join(dir, s))) : []
  const readDump = (name: string) => {
    for (const s of fs.readdirSync(dir)) return fs.readFileSync(path.join(dir, s, name), "utf8")
    return ""
  }

  beforeEach(() => {
    process.env.OCTO_MEMORY_DEBUG = "1"
    process.env.OCTO_MEMORY_DEBUG_DIR = dir
  })
  afterEach(() => {
    process.env.OCTO_MEMORY_DEBUG = "0"
    delete process.env.OCTO_MEMORY_DEBUG_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const circular = () => {
    const value: Record<string, unknown> = {}
    value.self = value
    return value
  }
  const input = (prompt: unknown[]) => ({
    sessionID: "ses_dbg",
    projectID: "p",
    model: "t/m",
    prompt,
    indexBefore: "",
    rawOutput: "ok",
    actions: [],
  })

  test("flag off performs no serialization and writes nothing", async () => {
    process.env.OCTO_MEMORY_DEBUG = "0"
    // 循环引用若被序列化会抛 TypeError;开关关闭时必须连序列化都不发生
    await Effect.runPromise(MemoryDebug.dumpExtract(input([circular()])))
    expect(dumps()).toHaveLength(0)
  })

  test("circular input never throws and falls back to a string representation", async () => {
    await Effect.runPromise(MemoryDebug.dumpExtract(input([circular()])))
    expect(dumps()).toHaveLength(1)
  })

  test("binary data is replaced with a placeholder", async () => {
    await Effect.runPromise(MemoryDebug.dumpExtract(input([new Uint8Array([1, 2, 3]), new ArrayBuffer(16)])))
    const name = dumps()[0]
    const content = readDump(name)
    expect(content).toContain("<Uint8Array 3 bytes>")
    expect(content).toContain("<ArrayBuffer 16 bytes>")
  })
})
