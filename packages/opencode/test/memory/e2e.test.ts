import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, beforeEach, describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Agent as AgentSvc } from "@/agent/agent"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "@/env"
import { ModelID, ProviderID } from "@/provider/schema"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Session } from "@/session/session"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SessionCompaction } from "@/session/compaction"
import { SessionSummary } from "@/session/summary"
import { Instruction } from "@/session/instruction"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Skill } from "@/skill"
import { SystemPrompt } from "@/session/system"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { ProjectID } from "@/project/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { start as startMemoryWorker } from "@/memory/worker"
import { extract } from "@/memory/extract"
import * as persist from "@/memory/persist"
import { MemoryStore } from "@/memory/store"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import * as Observability from "@opencode-ai/core/effect/observability"
import { tmpdirScoped, provideTmpdirServer } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

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
    startAuth: () => Effect.die("unexpected MCP auth in memory e2e tests"),
    authenticate: () => Effect.die("unexpected MCP auth in memory e2e tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in memory e2e tests"),
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
const proc = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
const env = Layer.mergeAll(
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

const it = testEffect(env)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
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
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

// preload 对整个测试进程设置了 OCTO_DISABLE_MEMORY=1;记忆 e2e 需要真实开启,
// 用例内删除该变量,结束后恢复,不影响其他测试文件。
beforeEach(() => {
  delete process.env.OCTO_DISABLE_MEMORY
})

afterEach(() => {
  process.env.OCTO_DISABLE_MEMORY = "1"
})

// 用测试层里的真实服务启动 Memory Worker(生命周期 = 测试作用域)
const bootWorker = Effect.fn("memoryE2E.bootWorker")(function* () {
  yield* startMemoryWorker({
    bus: yield* Bus.Service,
    sessions: yield* Session.Service,
    agents: yield* AgentSvc.Service,
    provider: yield* ProviderSvc.Service,
    llm: yield* LLM.Service,
    config: yield* Config.Service,
  })
})

const waitForFile = (file: string, timeoutMs = 20_000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (fs.existsSync(file)) return true
      yield* Effect.sleep("100 millis")
    }
    return fs.existsSync(file)
  })

const waitForInput = (llm: TestLLMServer["Service"], predicate: (body: string) => boolean, timeoutMs = 20_000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = (yield* llm.inputs).find((body) => predicate(stringify(body)))
      if (hit) return hit
      yield* Effect.sleep("100 millis")
    }
    return undefined
  })

const stringify = (body: unknown) => JSON.stringify(body)

const systemOf = (body: Record<string, unknown>) => {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : []
  const sys = messages.find((m) => m.role === "system")
  return sys ? JSON.stringify(sys.content) : ""
}

const findHit = (inputs: Record<string, unknown>[], needle: string) => {
  const hit = inputs.find((body) => stringify(body).includes(needle))
  expect(hit).toBeDefined()
  return hit!
}

const user = Effect.fn("memoryE2E.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("memoryE2E.assistant")(function* (sessionID: SessionID, parentID: MessageID) {
  const session = yield* Session.Service
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text: "知道了",
  })
  return msg
})

describe("memory e2e: cross-session pipeline", () => {
  it.live(
    "回合结束 → worker 提取 → 记忆落盘 → 新会话 system prompt 注入 <memory>",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            yield* bootWorker()
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service

            // 会话 1:主回复 + 提取回复(mock 队列按顺序消费,标题请求自动应答)
            yield* llm.text("好的,记住了")
            yield* llm.text(
              JSON.stringify([
                {
                  action: "create",
                  type: "feedback",
                  topic: "pkg_manager",
                  content: "本仓库包管理只用 pnpm,禁止 npm",
                  summary: "包管理器偏好",
                },
              ]),
            )

            const chat1 = yield* sessions.create({ title: "memory-e2e-1" })
            yield* prompt.prompt({
              sessionID: chat1.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "请记住:这个项目只用 pnpm,别用 npm" }],
            })
            const result1 = yield* prompt.loop({ sessionID: chat1.id })
            expect(result1.info.role).toBe("assistant")

            // idle 事件驱动 worker 在后台提取;落盘即完成信号
            const memoryDir = path.join(Global.Path.data, "memory", chat1.projectID)
            expect(yield* waitForFile(path.join(memoryDir, "MEMORY.md"))).toBe(true)
            expect(yield* waitForFile(path.join(memoryDir, ".cursors", chat1.id))).toBe(true)

            // 能存:topic 文件带 frontmatter,索引含条目
            const topic = fs.readFileSync(path.join(memoryDir, "topics", "pkg_manager.md"), "utf8")
            expect(topic).toContain("type: feedback")
            expect(topic).toContain("本仓库包管理只用 pnpm,禁止 npm")
            expect(fs.readFileSync(path.join(memoryDir, "MEMORY.md"), "utf8")).toContain("pkg_manager")

            // 记忆存在之前的请求不应注入
            expect(systemOf(findHit(yield* llm.inputs, "这个项目只用 pnpm"))).not.toContain("<memory>")

            // 会话 2(同项目、全新会话):主回复
            yield* llm.text("第二条回复")
            const chat2 = yield* sessions.create({ title: "memory-e2e-2" })
            yield* prompt.prompt({
              sessionID: chat2.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "新会话探针:装依赖该用什么命令?" }],
            })
            const result2 = yield* prompt.loop({ sessionID: chat2.id })
            expect(result2.info.role).toBe("assistant")

            // 跨会话注入:新会话的 system prompt 含 <memory> 与记忆内容
            const second = systemOf(findHit(yield* llm.inputs, "新会话探针"))
            expect(second).toContain("<memory>")
            expect(second).toContain("pkg_manager")
            expect(second).toContain("本仓库包管理只用 pnpm,禁止 npm")

            // 提取请求本身是 hidden agent:不注入 <memory>
            const extractionHit = (yield* llm.inputs).find((body) => stringify(body).includes("提取上述对话中的记忆"))
            expect(extractionHit).toBeDefined()
            expect(systemOf(extractionHit!)).not.toContain("<memory>")

            // 会话 2 的提取请求应携带已有记忆摘要(P0:提取模型据此去重/更新/合并)
            const secondExtraction = yield* waitForInput(llm, (body) =>
              body.includes("提取上述对话中的记忆") && body.includes("新会话探针") && body.includes("pkg_manager"),
            )
            expect(secondExtraction).toBeDefined()
          }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    60_000,
  )

  it.live(
    "直接落盘的记忆(不经 worker)同样注入新会话",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const chat = yield* sessions.create({ title: "memory-inject-only" })
            yield* Effect.sync(() =>
              persist.applyActions(
                chat.projectID,
                [
                  {
                    action: "create",
                    type: "user",
                    topic: "ui_theme",
                    content: "用户偏好暗色主题和简洁回复",
                    summary: "界面偏好",
                  },
                ],
                Date.now(),
              ),
            )

            yield* llm.text("ok")
            yield* prompt.prompt({
              sessionID: chat.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "注入探针:今天聊点什么?" }],
            })
            const result = yield* prompt.loop({ sessionID: chat.id })
            expect(result.info.role).toBe("assistant")

            const system = systemOf(findHit(yield* llm.inputs, "注入探针"))
            expect(system).toContain("<memory>")
            expect(system).toContain("用户偏好暗色主题和简洁回复")
          }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    60_000,
  )

  it.live(
    "OCTO_DISABLE_MEMORY=1:不注入、也不发起提取调用",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            process.env.OCTO_DISABLE_MEMORY = "1"
            yield* bootWorker()
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const chat = yield* sessions.create({ title: "memory-disabled" })
            yield* Effect.sync(() =>
              persist.applyActions(
                chat.projectID,
                [{ action: "create", type: "user", topic: "off_probe", content: "硬关闭时不应被注入", summary: "硬关闭" }],
                Date.now(),
              ),
            )

            yield* llm.text("ok") // 主回复
            yield* llm.text("[]") // 若 worker 违规提取会消费此回复

            yield* prompt.prompt({
              sessionID: chat.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "硬关闭探针:随便说点什么" }],
            })
            const result = yield* prompt.loop({ sessionID: chat.id })
            expect(result.info.role).toBe("assistant")

            expect(systemOf(findHit(yield* llm.inputs, "硬关闭探针"))).not.toContain("<memory>")

            // worker 静默跳过:idle 后不发起提取调用,队列里的提取回复原封不动
            yield* Effect.sleep("1 seconds")
            expect(yield* llm.pending).toBe(1)
          }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    60_000,
  )

  it.live(
    "游标恢复:重启后重复提取是无操作(不发起 LLM 调用)",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const agents = yield* AgentSvc.Service
            const provider = yield* ProviderSvc.Service
            const llmSvc = yield* LLM.Service

            const chat = yield* sessions.create({ title: "memory-cursor" })
            const userMsg = yield* user(chat.id, "记住:构建命令是 bun run build")
            const assistantMsg = yield* assistant(chat.id, userMsg.id)

            // 第一次提取:LLM 返回结构化记忆
            yield* llm.text(
              JSON.stringify([
                {
                  action: "create",
                  type: "project",
                  topic: "build_cmd",
                  content: "构建命令是 bun run build",
                  summary: "构建命令",
                },
              ]),
            )
            const r1 = yield* extract({
              sessionID: chat.id,
              projectID: chat.projectID,
              agent: agents,
              provider,
              llm: llmSvc,
              sessions,
            })
            expect(r1.parsed).toBe(1)
            expect(r1.applied).toBe(1)

            const memoryDir = path.join(Global.Path.data, "memory", chat.projectID)
            expect(fs.readFileSync(path.join(memoryDir, "topics", "build_cmd.md"), "utf8")).toContain("bun run build")
            // 游标按 sessionID 独立记录,停在最后一条消息上
            expect(persist.readCursor(chat.projectID, chat.id)).toBe(assistantMsg.id)

            // 模拟重启后再次提取:游标过滤后没有新消息,不应发起 LLM 调用
            yield* llm.text("SHOULD-NEVER-BE-CONSUMED")
            const r2 = yield* extract({
              sessionID: chat.id,
              projectID: chat.projectID,
              agent: agents,
              provider,
              llm: llmSvc,
              sessions,
            })
            expect(r2.parsed).toBe(0)
            expect(r2.applied).toBe(0)
            expect(yield* llm.pending).toBe(1)
          }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    60_000,
  )

  it.live(
    "跨会话游标独立:并行会话互不覆盖游标,重复提取无 LLM 调用",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const agents = yield* AgentSvc.Service
            const provider = yield* ProviderSvc.Service
            const llmSvc = yield* LLM.Service

            const run = (chat: { id: SessionID; projectID: ProjectID }, text: string, topic: string) =>
              Effect.gen(function* () {
                const userMsg = yield* user(chat.id, text)
                const assistantMsg = yield* assistant(chat.id, userMsg.id)
                yield* llm.text(
                  JSON.stringify([
                    { action: "create", type: "project", topic, content: `${text}的内容`, summary: topic },
                  ]),
                )
                const result = yield* extract({
                  sessionID: chat.id,
                  projectID: chat.projectID,
                  agent: agents,
                  provider,
                  llm: llmSvc,
                  sessions,
                })
                expect(result.applied).toBe(1)
                return { userMsg, assistantMsg }
              })

            const chat1 = yield* sessions.create({ title: "cursor-s1" })
            const chat2 = yield* sessions.create({ title: "cursor-s2" })

            // 两个 session 交错提取
            const s1 = yield* run(chat1, "会话一的偏好", "cursor_topic_a")
            const s2 = yield* run(chat2, "会话二的偏好", "cursor_topic_b")

            // 游标按 sessionID 独立,各指向自己的最后一条消息
            expect(persist.readCursor(chat1.projectID, chat1.id)).toBe(s1.assistantMsg.id)
            expect(persist.readCursor(chat2.projectID, chat2.id)).toBe(s2.assistantMsg.id)

            // chat1 再次提取(无新消息):不被 chat2 的游标影响而重放整个会话
            yield* llm.text("SHOULD-NEVER-BE-CONSUMED")
            const again = yield* extract({
              sessionID: chat1.id,
              projectID: chat1.projectID,
              agent: agents,
              provider,
              llm: llmSvc,
              sessions,
            })
            expect(again.parsed).toBe(0)
            expect(again.applied).toBe(0)
            expect(yield* llm.pending).toBe(1)
          }),
        { git: true, config: (url) => providerCfg(url) },
      ),
    60_000,
  )

  it.live("超预算索引被截断并附 read 工具提示", () =>
    Effect.gen(function* () {
      const projectID = ProjectID.make(
        createHash("sha256").update(path.resolve("/memory-e2e-budget-probe")).digest("hex").slice(0, 40),
      )
      yield* Effect.sync(() => persist.clear(projectID))
      yield* Effect.sync(() =>
        persist.applyActions(
          projectID,
          [
            { action: "create", type: "reference", topic: "api_notes", content: "详情见文件", summary: "偏".repeat(200) },
            { action: "create", type: "reference", topic: "more_notes", content: "详情见文件", summary: "好".repeat(200) },
          ],
          Date.now(),
        ),
      )

      // 两条 200 字 CJK 摘要 ≈ 440 tokens,超出 300 预算 → 截断
      const truncated = MemoryStore.system(projectID, 300)
      expect(truncated).toContain("<memory>")
      expect(truncated).toContain("已截断")

      // 宽松预算下完整注入
      const full = MemoryStore.system(projectID, 2000)
      expect(full).toContain("偏".repeat(50))
      expect(full).not.toContain("已截断")

      yield* Effect.sync(() => persist.clear(projectID))
    }),
  )
})

// ---------------------------------------------------------------------------
// 生产装配路径:真实 InstanceStore + 真实 InstanceBootstrap(memory worker 由
// bootstrap 启动,而非测试手动拉起),验证 worker 生命周期未被 bootstrap 杀死。
// ---------------------------------------------------------------------------

const prodIt = testEffect(
  Layer.mergeAll(
    TestLLMServer.layer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(
      Layer.provide(InstanceBootstrap.defaultLayer),
      Layer.provideMerge(Observability.layer),
    ),
    SessionPrompt.defaultLayer,
    Session.defaultLayer,
  ),
)

prodIt.live(
  "生产装配:真实 bootstrap 启动的 memory worker 存活并完成提取",
  () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const store = yield* InstanceStore.Service
      const dir = yield* tmpdirScoped({ git: true, config: providerCfg(llm.url) })

      yield* store.provide(
        { directory: dir },
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          yield* llm.text("好的") // 主回复
          // 提取回复只匹配提取请求,防止被 summary 等其它 LLM 调用抢走
          yield* llm.textMatch(
            (hit) => JSON.stringify(hit.body).includes("提取上述对话中的记忆"),
            JSON.stringify([
              {
                action: "create",
                type: "feedback",
                topic: "prod_wiring",
                content: "生产装配验证记忆",
                summary: "生产装配",
              },
            ]),
          )

          const chat = yield* sessions.create({ title: "prod-wiring" })
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "生产装配探针:请记住 prod_wiring" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          expect(result.info.role).toBe("assistant")

          const memoryDir = path.join(Global.Path.data, "memory", chat.projectID)
          expect(yield* waitForFile(path.join(memoryDir, "MEMORY.md"))).toBe(true)
          const topic = fs.readFileSync(path.join(memoryDir, "topics", "prod_wiring.md"), "utf8")
          expect(topic).toContain("生产装配验证记忆")
        }),
      )
    }),
  120_000,
)
