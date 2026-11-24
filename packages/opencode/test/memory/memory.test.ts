import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"
import { MemoryStore } from "@/memory/store"
import { MemoryExtract, parseActions } from "@/memory/extract"
import { MemoryDebug } from "@/memory/debug"
import { MemoryTombstoneTable } from "@/memory/tombstone.sql"
import type { MemoryType } from "@/memory/memory.sql"
import { Database } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import type { ProjectID } from "@/project/schema"
import type { ConfigMemory } from "@/config/memory"
import type { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import type { MessageV2 } from "@/session/message-v2"
import type * as Session from "@/session/session"

const projectID = "mem_test_project" as ProjectID
const otherID = "mem_test_other" as ProjectID
const budget = MemoryStore.DEFAULT_BUDGET_TOKENS

// preload 对整个测试进程设置了 OCTO_DISABLE_MEMORY=1,存储层测试需要显式开启并在结束后恢复
beforeEach(() => {
  delete process.env.OCTO_DISABLE_MEMORY
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: "/tmp/mem-test", sandboxes: [] })
      .onConflictDoNothing()
      .run(),
  )
  MemoryStore.clear(projectID)
  MemoryStore.clear(otherID)
  Database.use((db) => db.delete(MemoryTombstoneTable).run())
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

  test("single oversized entry skips itself without blocking shorter ones", () => {
    // 显式版本控制排序:A(短)→B(超长)→C(短);B 超预算被跳过,但不得阻断其后的 C
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
    const system = MemoryStore.system(projectID, 20)
    expect(system).toHaveLength(1)
    expect(system[0]).toContain("short_a")
    expect(system[0]).toContain("short_c")
    expect(system[0]).not.toContain("long_b")
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

  test("write is a no-op while OCTO_DISABLE_MEMORY is set", () => {
    process.env.OCTO_DISABLE_MEMORY = "1"
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "user", topic: "blocked", content: "x", summary: "y" }],
      budget,
    })
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    delete process.env.OCTO_DISABLE_MEMORY
    MemoryStore.write({
      projectID,
      actions: [{ action: "create", type: "user", topic: "allowed", content: "x", summary: "y" }],
      budget,
    })
    expect(MemoryStore.list(projectID)).toHaveLength(1)
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
    expect(parseActions('好的：\n[' + JSON.stringify(entry()) + ']\n以上。')).toHaveLength(1)
  })

  test("delete only needs a valid topic", () => {
    expect(parseActions(`[{"action":"delete","topic":"stale"}]`)).toEqual([
      { action: "delete", topic: "stale" },
    ])
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

  const session = (id: string, proj: ProjectID = projectID) =>
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
    project?: ProjectID
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
    // FK 缺失的 project:提取内容合法但写入必失败,游标不得推进
    const fkProject = "mem_fk_project" as ProjectID
    const { llm, calls } = fakeLLM([reply, reply])
    const history = [
      msg("u0", "user", "第零个回合"),
      msg("a0", "assistant", "嗯"),
      msg("u1", "user", "第一个回合"),
      msg("a1", "assistant", "好的"),
    ]
    await run({ sessionId: "ses_h", history, llm, project: fkProject })
    expect(calls).toHaveLength(1)
    await run({
      sessionId: "ses_h",
      interval: 0,
      history: [...history, msg("u2", "user", "第二个回合"), msg("a2", "assistant", "收到")],
      llm,
      project: fkProject,
    })
    expect(calls).toHaveLength(2)
    const retried = JSON.stringify(calls[1].messages)
    expect(retried).toContain("第一个回合")
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

describe("cursor ordering: advance only after successful write", () => {
  const entry = (topic: string) => ({
    action: "create" as const,
    type: "project" as MemoryType,
    topic,
    content: "c",
    summary: "s",
  })

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

  test("write returns false while disabled and true on success", () => {
    process.env.OCTO_DISABLE_MEMORY = "1"
    expect(MemoryStore.write({ projectID, actions: [entry("blocked")], budget })).toBe(false)
    delete process.env.OCTO_DISABLE_MEMORY
    expect(MemoryStore.write({ projectID, actions: [entry("allowed")], budget })).toBe(true)
  })

  test("write returns false on database constraint failure", () => {
    // 未播种的 project 触发 FK 约束,事务回滚,safe 降级后必须返回 false
    expect(
      MemoryStore.write({ projectID: "mem_fk_project" as ProjectID, actions: [entry("x")], budget }),
    ).toBe(false)
  })
})

describe("memory tombstone", () => {
  const entry = (topic: string) => ({
    action: "create" as const,
    type: "project" as MemoryType,
    topic,
    content: "c",
    summary: "s",
  })
  const tombstones = () => Database.use((db) => db.select().from(MemoryTombstoneTable).all())

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
    expect(tombstones().filter((row) => row.topic === "t")).toHaveLength(0)
  })

  test("old delete cannot overwrite a newer tombstone", () => {
    MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "gone" }], budget, version: 2000 })
    MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "gone" }], budget, version: 900 })
    expect(tombstones().find((row) => row.topic === "gone")?.time_deleted).toBe(2000)
  })

  test("tombstone from deleting an absent topic blocks older creates", () => {
    MemoryStore.write({ projectID, actions: [{ action: "delete", topic: "ghost" }], budget, version: 2000 })
    expect(MemoryStore.write({ projectID, actions: [entry("ghost")], budget, version: 1500 })).toBe(true)
    expect(MemoryStore.list(projectID)).toHaveLength(0)
    expect(MemoryStore.write({ projectID, actions: [entry("ghost")], budget, version: 2500 })).toBe(true)
    expect(MemoryStore.list(projectID).some((row) => row.topic === "ghost")).toBe(true)
  })
})

describe("memory debug isolation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-dbg-test-"))
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
