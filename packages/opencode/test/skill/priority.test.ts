import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Skill } from "../../src/skill"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

// 直接使用真实 octoConfig 路径(与 agent-config.test.ts 同模式),测试后清理
const octoConfigDir = Global.Path.octoConfig
const SKILL_NAME = "prio-conflict-skill"

async function writeSkill(dir: string, description: string) {
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(
    path.join(dir, "SKILL.md"),
    `---
name: ${SKILL_NAME}
description: ${description}
---

# ${SKILL_NAME}
`,
  )
}

describe("skill source priority", () => {
  test("octo config skill wins name conflict over project skill", async () => {
    const tmp = await tmpdir({ git: true })
    const octoSkillDir = path.join(octoConfigDir, "skill", "prio-octo-copy")
    const projectSkillDir = path.join(tmp.path, ".opencode", "skill", "prio-project-copy")
    await writeSkill(octoSkillDir, "from octo config")
    await writeSkill(projectSkillDir, "from project")

    const store = ManagedRuntime.make(InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)))
    const ctx = await store.runPromise(InstanceStore.Service.use((s) => s.load({ directory: tmp.path })))
    const runtime = ManagedRuntime.make(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap))

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const item = yield* skill.get(SKILL_NAME)
          expect(item).toBeDefined()
          expect(item!.description).toBe("from octo config")
          expect(item!.location).toBe(path.join(octoSkillDir, "SKILL.md"))
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await store.runPromise(InstanceStore.Service.use((s) => s.dispose(ctx)))
      await fs.rm(octoSkillDir, { recursive: true, force: true })
      await tmp[Symbol.asyncDispose]()
    }
  })

  test("nested octo copy does not shadow depth-1 octo skill", async () => {
    const tmp = await tmpdir({ git: true })
    const octoDepth1 = path.join(octoConfigDir, "skill", "prio-nested-skill")
    const octoNested = path.join(octoDepth1, "dist")
    await writeSkill(octoDepth1, "canonical depth-1 copy")
    await writeSkill(octoNested, "nested dist copy")

    const store = ManagedRuntime.make(InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)))
    const ctx = await store.runPromise(InstanceStore.Service.use((s) => s.load({ directory: tmp.path })))
    const runtime = ManagedRuntime.make(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap))

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const item = yield* skill.get(SKILL_NAME)
          expect(item).toBeDefined()
          expect(item!.description).toBe("canonical depth-1 copy")
          expect(item!.location).toBe(path.join(octoDepth1, "SKILL.md"))
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await store.runPromise(InstanceStore.Service.use((s) => s.dispose(ctx)))
      await fs.rm(octoDepth1, { recursive: true, force: true })
      await tmp[Symbol.asyncDispose]()
    }
  })
})
