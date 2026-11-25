// 端到端:跨会话记忆在"开启"状态下走完 提取 → 落库 → 注入 → 埋点落盘 全链路。
// preload 对全测试进程设了 OCTO_DISABLE_MEMORY=1(保护旧测试的 mock 队列),本文件
// 在 beforeAll 显式开启、afterAll 严格恢复,保证后续测试文件不受影响。
import { afterAll, beforeAll, describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Snapshot } from "../../src/snapshot"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { MemoryStore } from "@/memory/store"
import { Config } from "@/config/config"
import { TestLLMServer } from "../lib/llm-server"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const debugDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-e2e-"))

beforeAll(() => {
  delete process.env.OCTO_DISABLE_MEMORY
  process.env.OCTO_MEMORY_DEBUG = "1"
  process.env.OCTO_MEMORY_DEBUG_DIR = debugDir
})

afterAll(() => {
  process.env.OCTO_DISABLE_MEMORY = "1"
  // 恢复为 preload 的默认值 "0"(而非 delete,否则会退回 flag 的默认常开)
  process.env.OCTO_MEMORY_DEBUG = "0"
  delete process.env.OCTO_MEMORY_DEBUG_DIR
  fs.rmSync(debugDir, { recursive: true, force: true })
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    toolsForAgent: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in memory e2e"),
    authenticate: () => Effect.die("unexpected MCP auth in memory e2e"),
    finishAuth: () => Effect.die("unexpected MCP auth in memory e2e"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

// 与 prompt.test.ts 同款 SessionPrompt 全栈(真实服务 + MCP/LSP mock)
function makeStack() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const summary = Layer.succeed(
    SessionSummary.Service,
    SessionSummary.Service.of({
      summarize: () => Effect.void,
      diff: () => Effect.succeed([]),
      computeDiff: () => Effect.succeed([]),
    }),
  )
  const proc = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provide(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(Layer.provide(summary))
}

const it = testEffect(makeStack())

// 注册自定义 "test" provider,使 provider 模型解析命中测试 LLM server
const providerCfg = (url: string) => ({
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

const extractReply = JSON.stringify([
  {
    action: "create",
    type: "feedback",
    topic: "pnpm_preference",
    content: "本仓库所有安装/执行命令必须使用 pnpm，不要使用 npm。",
    summary: "本仓库只用 pnpm，禁止 npm",
  },
])

const findDump = (kind: "extract" | "inject", needle: string) => {
  for (const session of fs.readdirSync(debugDir)) {
    const sessionPath = path.join(debugDir, session)
    if (!fs.statSync(sessionPath).isDirectory()) continue
    for (const file of fs.readdirSync(sessionPath)) {
      if (!file.endsWith(`_${kind}.txt`)) continue
      const content = fs.readFileSync(path.join(sessionPath, file), "utf8")
      if (content.includes(needle)) return content
    }
  }
  return undefined
}

describe("memory e2e (feature ON)", () => {
  it.live("extraction persists a memory and the next turn injects it", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({
          title: "Pinned",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // 队列按消耗顺序:主回合回复 → 提取器 JSON 回复
        yield* llm.text("好的，已记住")
        yield* llm.text(extractReply)
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "请记住：这个仓库只用 pnpm，不要用 npm" }],
        })

        // 提取是 loop 退出后的后台 fiber,轮询 DB 等它落库
        let rows: MemoryStore.Row[] = []
        for (let i = 0; i < 100 && rows.length === 0; i++) {
          yield* Effect.sleep("50 millis")
          rows = MemoryStore.list(chat.projectID)
        }
        expect(rows.some((row) => row.topic === "pnpm_preference" && row.source_session_id === chat.id)).toBe(true)

        // 第二轮:prepareRequest 注入记忆;本轮提取被 60s 节流跳过,不消耗队列
        yield* llm.text("done")
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "安装依赖该用什么命令" }],
        })

        // 注入埋点在请求准备阶段同步完成,短暂轮询兜底异步 fs 写
        let injectDump: string | undefined
        for (let i = 0; i < 20 && !injectDump; i++) {
          yield* Effect.sleep("50 millis")
          injectDump = findDump("inject", "pnpm_preference")
        }
        expect(injectDump).toBeDefined()
        expect(injectDump).toContain("<memory>")
        // feedback 属核心层级:索引行直接展开完整 content,并带短 ID 与 memory_read 指引
        expect(injectDump).toMatch(/\[.*?\] \(feedback\) pnpm_preference: 本仓库所有安装/)
        expect(injectDump).toContain("memory_read")
        expect(injectDump).toContain("memory tokens:")

        const extractDump = findDump("extract", "pnpm_preference")
        expect(extractDump).toBeDefined()
        expect(extractDump).toContain("RAW MODEL OUTPUT")
        expect(extractDump).toContain("pnpm_preference")
      }),
      { git: true, config: providerCfg },
    ),
  )
})
