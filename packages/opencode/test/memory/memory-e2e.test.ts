// 端到端:Agent 自主维护记忆全链路(与 Claude Code 一致)。
// preload 对全测试进程设了 OCTO_DISABLE_MEMORY=1,本文件在 beforeAll 显式开启、
// afterAll 严格恢复,保证后续测试文件不受影响。
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
import { Config } from "@/config/config"
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
import { MessageID } from "../../src/session/schema"
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
import { TestLLMServer } from "../lib/llm-server"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Global } from "@opencode-ai/core/global"

beforeAll(() => {
  delete process.env.OCTO_DISABLE_MEMORY
})

afterAll(() => {
  process.env.OCTO_DISABLE_MEMORY = "1"
})

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

describe("memory e2e (agent-maintained, Claude-style)", () => {
  it.live("bootstrap injected, agent writes memory via write tool, next turn injects it", () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({
          title: "Pinned",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // 第一轮:空记忆 → 注入引导块,模型应"知道"自己可以建记忆
        yield* llm.text("好的")
        const first = yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "记住这个仓库只用 pnpm" }],
        })
        expect(first.info.role).toBe("assistant")

        const memoryDir = path.join(Global.Path.data, "memory", chat.projectID)
        const indexFile = path.join(memoryDir, "MEMORY.md")

        // 模型自主维护:用 write 工具直接写记忆文件(工作目录外 → external_directory 授权,
        // 会话已 allow 全部权限,直接通过)
        const registry = yield* ToolRegistry.Service
        const all = yield* registry.all()
        const writeTool = all.find((tool) => tool.id === "write")!
        const writeResult = yield* writeTool.execute(
          {
            filePath: indexFile,
            content: "# Memory\n\n- (feedback) pnpm_preference: 本仓库只用 pnpm,禁止 npm。\n",
          },
          {
            sessionID: chat.id,
            messageID: MessageID.make("msg_e2e_memory"),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        expect(writeResult.output).toContain("Wrote file successfully")

        // 下一轮:注入块包含模型自己写的记忆行(记忆闭环成立)
        const block = MemoryStore.system(chat.projectID)
        expect(block).toContain("pnpm_preference: 本仓库只用 pnpm")
        yield* llm.text("done")
        const second = yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "安装依赖该用什么" }],
        })
        expect(second.info.role).toBe("assistant")

        // 清理本测试项目的记忆目录,不影响其他项目
        MemoryStore.clear(chat.projectID)
      }),
      { git: true, config: providerCfg },
    ),
  )
})
