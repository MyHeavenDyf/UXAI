import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const registryLayer = ToolRegistry.layer.pipe(
  Layer.provide(configLayer),
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Question.defaultLayer),
  Layer.provide(Todo.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(LSP.defaultLayer),
  Layer.provide(Instruction.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Format.defaultLayer),
  Layer.provide(node),
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(Truncate.defaultLayer),
)

const it = testEffect(Layer.mergeAll(registryLayer, Agent.defaultLayer, node))

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.registry", () => {
  it.instance("loads tools from .opencode/tool (singular)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tool = path.join(opencode, "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
    { timeout: 30_000 },
  )

  it.instance("loads tools from .opencode/tools (plural)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
    { timeout: 30_000 },
  )

  it.instance("loads tools with external dependencies without crashing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@opencode-ai/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@opencode-ai/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        ),
      )

      const cowsay = path.join(opencode, "node_modules", "cowsay")
      yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("cowsay")
    }),
    { timeout: 30_000 },
  )

  // SPEC-INS-021 §1:insight 的编辑类工具在 registry 层按 agent 裁剪——不能走权限层 deny,
  // EDIT_TOOLS 共享 "edit" 权限键会连带隐藏 write。
  // 2026-07-30 起 edit 已放开(供编辑 md 交付物,outputs 重定向插件同步覆盖了 edit 的 filePath),
  // 只剩 apply_patch 仍摘(整段 patchText、无单一 filePath,插件无法重定向)——本用例的断言随之更新。
  it.instance("octo_insight excludes apply_patch but keeps write/edit (SPEC-INS-021 §1)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const insight = yield* Agent.Service.use((svc) => svc.get("octo_insight"))
      expect(insight).toBeDefined()
      const tools = yield* registry.tools({
        providerID: "anthropic" as Parameters<typeof registry.tools>[0]["providerID"],
        modelID: "claude-sonnet" as Parameters<typeof registry.tools>[0]["modelID"],
        agent: insight!,
      })
      const ids = tools.map((t) => t.id)
      expect(ids).not.toContain("apply_patch")
      expect(ids).toContain("write")
      expect(ids).toContain("edit")
      expect(ids).toContain("extract_document")
    }),
    { timeout: 30_000 },
  )

  // SPEC-INS-032 §3:extract_document 的裁剪**已搬离 registry** —— 这一层对所有 agent 一视同仁,
  // 由 agent 权限层声明(defaults deny + 需要者显式 allow,断言见 test/agent/agent.test.ts)。
  // 本用例钉的是"registry 不再按 agent 名裁它":若有人把那条 gate 加回来,这里会红。
  it.instance("registry no longer gates extract_document by agent name (SPEC-INS-032 §3)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const make = yield* Agent.Service.use((svc) => svc.get("octo_make"))
      expect(make).toBeDefined()
      const tools = yield* registry.tools({
        providerID: "anthropic" as Parameters<typeof registry.tools>[0]["providerID"],
        modelID: "claude-sonnet" as Parameters<typeof registry.tools>[0]["modelID"],
        agent: make!,
      })
      expect(tools.map((t) => t.id)).toContain("extract_document")
    }),
    { timeout: 30_000 },
  )

  // SPEC-INS-030:knowledge_search 从 chat 的 octo_ai 迁到 insight 的 octo_insight。
  // 网关是硬隔离(registry.tools() 过滤),这里正反两面各钉一次:insight 拿得到、make 拿不到。
  it.instance("knowledge_search is gated to octo_insight only (SPEC-INS-030 §2)", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const idsFor = (agent: Agent.Info) =>
        registry
          .tools({
            providerID: "anthropic" as Parameters<typeof registry.tools>[0]["providerID"],
            modelID: "claude-sonnet" as Parameters<typeof registry.tools>[0]["modelID"],
            agent,
          })
          .pipe(Effect.map((tools) => tools.map((t) => t.id)))

      const insight = yield* Agent.Service.use((svc) => svc.get("octo_insight"))
      expect(yield* idsFor(insight)).toContain("knowledge_search")

      const make = yield* Agent.Service.use((svc) => svc.get("octo_make"))
      expect(yield* idsFor(make)).not.toContain("knowledge_search")
    }),
    { timeout: 30_000 },
  )
})
