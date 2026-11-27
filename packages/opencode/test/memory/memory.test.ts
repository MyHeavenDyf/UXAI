import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { MemoryStore } from "@/memory/store"
import { MemoryDebug } from "@/memory/debug"
import type { ProjectID } from "@/project/schema"

const projectID = "mem_test_project" as ProjectID
const budget = MemoryStore.DEFAULT_BUDGET_TOKENS

const projectPath = (id: string) => path.join(Global.Path.data, "memory", id)
const indexFile = (id: string) => path.join(projectPath(id), "MEMORY.md")

// preload 对整个测试进程设置了 OCTO_DISABLE_MEMORY=1,存储层测试需要显式开启并在结束后恢复
beforeEach(() => {
  delete process.env.OCTO_DISABLE_MEMORY
  fs.rmSync(projectPath(projectID), { recursive: true, force: true })
})

afterEach(() => {
  process.env.OCTO_DISABLE_MEMORY = "1"
})

// 模拟 Agent 写记忆:与 Claude Code 一致,模型用普通文件写入,不经任何专用通道
const agentWriteIndex = (id: string, content: string) => {
  fs.mkdirSync(projectPath(id), { recursive: true })
  fs.mkdirSync(path.join(projectPath(id), "topics"), { recursive: true })
  fs.writeFileSync(indexFile(id), content)
}

describe("agent-maintained memory injection", () => {
  test("empty memory injects a bootstrap block so the agent knows it can start", () => {
    const block = MemoryStore.system(projectID)
    expect(block).toContain("<memory>")
    // 维护指示:目录绝对路径 + 何时写 + 怎么写 + 参考数据声明
    expect(block).toContain(projectPath(projectID))
    expect(block).toContain("自主维护")
    expect(block).toContain("read/write/edit")
    expect(block).toContain("参考数据")
    // 空记忆引导:告诉模型现在还没有记忆,值得记时主动创建
    expect(block).toContain("当前还没有任何记忆")
  })

  test("agent-written index is injected verbatim on the next request", () => {
    agentWriteIndex(
      projectID,
      ["# Memory", "", "- (feedback) pnpm_preference: 本仓库只用 pnpm,禁止 npm。", "- (user) role: 前端工程师", ""].join(
        "\n",
      ),
    )
    const block = MemoryStore.system(projectID)
    expect(block).toContain("pnpm_preference: 本仓库只用 pnpm")
    expect(block).toContain("role: 前端工程师")
  })

  test("index beyond budget is truncated with a read hint", () => {
    agentWriteIndex(projectID, "- (project) big: " + "x".repeat(4000))
    const block = MemoryStore.system(projectID, 100)
    expect(block).toContain("索引超预算已截断")
    expect(block).toContain("read 工具")
  })

  test("manual junk lines in the index are injected as-is (agent owns the file)", () => {
    agentWriteIndex(projectID, "随便一行自由文本\n- (feedback) ok: 正常行")
    const block = MemoryStore.system(projectID)
    expect(block).toContain("随便一行自由文本")
    expect(block).toContain("正常行")
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
})

describe("effectiveBudget", () => {
  test("scales down for small context windows, floors at minimum", () => {
    expect(MemoryStore.effectiveBudget(2000, undefined)).toBe(2000)
    expect(MemoryStore.effectiveBudget(2000, 65536)).toBe(2000)
    expect(MemoryStore.effectiveBudget(5000, 65536)).toBe(5000)
    expect(MemoryStore.effectiveBudget(2000, 8192)).toBe(1024)
    expect(MemoryStore.effectiveBudget(2000, 4096)).toBe(512)
    expect(MemoryStore.effectiveBudget(2000, 2048)).toBe(MemoryStore.MIN_BUDGET_TOKENS)
    expect(MemoryStore.effectiveBudget(2000, 256)).toBe(MemoryStore.MIN_BUDGET_TOKENS)
  })
})

describe("index nudge (post-write size feedback, Claude-style)", () => {
  test("MEMORY.md over budget triggers a self-organize reminder", () => {
    agentWriteIndex(projectID, "- (project) big: " + "x".repeat(4000))
    const nudge = MemoryStore.indexNudge(indexFile(projectID), 100)
    expect(nudge).toBeDefined()
    expect(nudge).toContain("超出索引预算")
    expect(nudge).toContain("topics/")
  })

  test("MEMORY.md within budget produces no output", () => {
    agentWriteIndex(projectID, "- (feedback) small: ok")
    expect(MemoryStore.indexNudge(indexFile(projectID), 100)).toBeUndefined()
  })

  test("non-index files and foreign paths never nudge", () => {
    agentWriteIndex(projectID, "- (feedback) small: ok")
    expect(MemoryStore.indexNudge(path.join(projectPath(projectID), "topics", "x.md"), 10)).toBeUndefined()
    expect(MemoryStore.indexNudge(path.join(fs.realpathSync("/tmp"), "MEMORY.md"), 10)).toBeUndefined()
  })
})

describe("clear", () => {
  test("wipes the whole project directory", () => {
    agentWriteIndex(projectID, "- (feedback) a: b")
    fs.writeFileSync(path.join(projectPath(projectID), "topics", "a.md"), "content")
    MemoryStore.clear(projectID)
    expect(fs.existsSync(projectPath(projectID))).toBe(false)
    expect(MemoryStore.system(projectID)).toContain("当前还没有任何记忆")
  })
})

describe("debug isolation", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "memory-dbg-test-"))
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

  test("flag off performs no serialization and writes nothing", async () => {
    process.env.OCTO_MEMORY_DEBUG = "0"
    // 循环引用若被序列化会抛 TypeError;开关关闭时必须连序列化都不发生
    const circular = () => {
      const value: Record<string, unknown> = {}
      value.self = value
      return value
    }
    await Effect.runPromise(
      MemoryDebug.dumpInject({
        sessionID: "ses_dbg",
        model: "t/m",
        memoryTokens: 10,
        system: [],
        modelMsgs: [circular()],
        activeTools: {},
      }),
    )
    expect(dumps()).toHaveLength(0)
  })

  test("circular input never throws and falls back to a string representation", async () => {
    const circular = () => {
      const value: Record<string, unknown> = {}
      value.self = value
      return value
    }
    await Effect.runPromise(
      MemoryDebug.dumpInject({
        sessionID: "ses_dbg",
        model: "t/m",
        memoryTokens: 10,
        system: [],
        modelMsgs: [circular()],
        activeTools: {},
      }),
    )
    expect(dumps()).toHaveLength(1)
  })

  test("redacts secrets and replaces binary data", async () => {
    await Effect.runPromise(
      MemoryDebug.dumpInject({
        sessionID: "ses_dbg",
        model: "t/m",
        memoryTokens: 10,
        system: [],
        modelMsgs: [{ key: "sk-abcdefgh12345678" }, new Uint8Array([1, 2, 3])],
        activeTools: {},
      }),
    )
    const content = readDump(dumps()[0])
    expect(content).toContain("[REDACTED]")
    expect(content).toContain("<Uint8Array 3 bytes>")
  })

  test("records memory tokens in the header", async () => {
    await Effect.runPromise(
      MemoryDebug.dumpInject({
        sessionID: "ses_dbg",
        model: "t/m",
        memoryTokens: 2137,
        system: [],
        modelMsgs: [],
        activeTools: {},
      }),
    )
    expect(readDump(dumps()[0])).toContain("memory tokens:   2137")
  })
})

describe("config", () => {
  test("memory config surface is agent-maintenance only (no extractor knobs)", () => {
    // enabled + budget_tokens 是仅有的两个旋钮;提取器时代字段已删除
    expect(MemoryStore.disabled({ enabled: false })).toBe(true)
    expect(MemoryStore.DEFAULT_BUDGET_TOKENS).toBe(2000)
  })
})
