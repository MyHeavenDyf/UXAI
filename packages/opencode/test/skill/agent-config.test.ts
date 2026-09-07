import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Skill } from "../../src/skill"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import path from "path"
import fs from "fs/promises"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

// 直接使用真实的 octoConfig 路径
const octoConfigDir = Global.Path.octoConfig

// 保存原始文件内容用于恢复
let originalSkillConfig: string | null = null
let originalSkillsJson: string | null = null

function makeAgent(name: string): Agent.Info {
  return {
    name,
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

async function readFileSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8")
  } catch {
    return null
  }
}

async function backupOriginals() {
  originalSkillConfig = await readFileSafe(path.join(octoConfigDir, "skill_config.json"))
  originalSkillsJson = await readFileSafe(path.join(octoConfigDir, "skills.json"))
}

async function restoreOriginals() {
  if (originalSkillConfig !== null) {
    await fs.writeFile(path.join(octoConfigDir, "skill_config.json"), originalSkillConfig, "utf-8")
  } else {
    await fs.rm(path.join(octoConfigDir, "skill_config.json"), { force: true })
  }
  if (originalSkillsJson !== null) {
    await fs.writeFile(path.join(octoConfigDir, "skills.json"), originalSkillsJson, "utf-8")
  } else {
    await fs.rm(path.join(octoConfigDir, "skills.json"), { force: true })
  }
}

beforeAll(async () => {
  await backupOriginals()
})

afterAll(async () => {
  await restoreOriginals()
})

/**
 * 在每个测试前准备：清空 skill_config.json 和 skills.json，创建实例目录下的 skill 文件
 */
async function setupTest(skills: { dirName: string; name: string; desc: string }[]) {
  const tmp = await tmpdir({ git: true })

  // 在实例目录下创建 SKILL.md
  for (const s of skills) {
    const skillDir = path.join(tmp.path, ".opencode", "skill", s.dirName)
    await fs.mkdir(skillDir, { recursive: true })
    await Bun.write(
      path.join(skillDir, "SKILL.md"),
      `---
name: ${s.name}
description: ${s.desc}
---

# ${s.name}
`,
    )
  }

  // 创建 store 和实例上下文
  const store = ManagedRuntime.make(InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)))
  const ctx = await store.runPromise(InstanceStore.Service.use((s) => s.load({ directory: tmp.path })))

  const cleanup = async () => {
    await store.runPromise(InstanceStore.Service.use((s) => s.dispose(ctx)))
    await tmp[Symbol.asyncDispose]()
  }

  return { tmp, store, ctx, cleanup }
}

describe("skill agentConfig with skill_config.json", () => {
  test("available() filters skills by agentConfig from skill_config.json", async () => {
    const { ctx, cleanup } = await setupTest([
      { dirName: "html-proto", name: "html-proto", desc: "HTML prototyping skill" },
      { dirName: "interview-ai", name: "interview-ai", desc: "Interview analysis skill" },
    ])

    // 写入 skill_config.json 到真实 octoConfig 目录
    await fs.writeFile(
      path.join(octoConfigDir, "skill_config.json"),
      JSON.stringify({
        skill: {
          "html-proto": { description: "HTML prototyping skill", import: true, type: "octo_make" },
          "interview-ai": { description: "Interview analysis skill", import: true, type: "octo_insight" },
        },
        agent: {
          octo_insight: ["interview-ai"],
          octo_make: ["html-proto"],
          octo_studio: [],
        },
      }, null, 2),
    )

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service

          const makeSkills = yield* skill.available(makeAgent("octo_make"))
          expect(makeSkills.map((s) => s.name).sort()).toEqual(["html-proto"])

          const insightSkills = yield* skill.available(makeAgent("octo_insight"))
          expect(insightSkills.map((s) => s.name).sort()).toEqual(["interview-ai"])

          const studioSkills = yield* skill.available(makeAgent("octo_studio"))
          expect(studioSkills).toEqual([])
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await cleanup()
    }
  })

  test("available() respects permission deny even when skill is in agentConfig", async () => {
    const { ctx, cleanup } = await setupTest([
      { dirName: "html-proto", name: "html-proto", desc: "HTML prototyping skill" },
    ])

    await fs.writeFile(
      path.join(octoConfigDir, "skill_config.json"),
      JSON.stringify({
        skill: { "html-proto": { description: "HTML prototyping skill", import: true, type: "octo_make" } },
        agent: { octo_insight: [], octo_make: ["html-proto"], octo_studio: [] },
      }, null, 2),
    )

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const agent: Agent.Info = {
            name: "octo_make",
            mode: "primary",
            options: {},
            permission: [{ permission: "skill", pattern: "html-proto", action: "deny" }],
          }
          const skills = yield* skill.available(agent)
          expect(skills).toEqual([])
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await cleanup()
    }
  })
})

describe("skill fallback to skills.json", () => {
  test("falls back to skills.json when skill_config.json does not exist", async () => {
    const { ctx, cleanup } = await setupTest([
      { dirName: "html-proto", name: "html-proto", desc: "HTML prototyping skill" },
      { dirName: "interview-ai", name: "interview-ai", desc: "Interview analysis skill" },
    ])

    // 删除 skill_config.json，只写 skills.json
    await fs.rm(path.join(octoConfigDir, "skill_config.json"), { force: true })
    await fs.writeFile(
      path.join(octoConfigDir, "skills.json"),
      JSON.stringify({
        "html-proto": { description: "HTML prototyping skill", import: true, type: "octo_make" },
        "interview-ai": { description: "Interview analysis skill", import: true, type: "octo_insight" },
      }, null, 2),
    )

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service

          const makeSkills = yield* skill.available(makeAgent("octo_make"))
          expect(makeSkills.map((s) => s.name).sort()).toEqual(["html-proto"])

          const insightSkills = yield* skill.available(makeAgent("octo_insight"))
          expect(insightSkills.map((s) => s.name).sort()).toEqual(["interview-ai"])

          const studioSkills = yield* skill.available(makeAgent("octo_studio"))
          expect(studioSkills).toEqual([])
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await cleanup()
    }
  })

  test("fallback does NOT write skill_config.json from skills.json", async () => {
    const { ctx, cleanup } = await setupTest([
      { dirName: "html-proto", name: "html-proto", desc: "HTML prototyping skill" },
    ])

    await fs.rm(path.join(octoConfigDir, "skill_config.json"), { force: true })
    await fs.writeFile(
      path.join(octoConfigDir, "skills.json"),
      JSON.stringify({
        "html-proto": { description: "HTML prototyping skill", import: true, type: "octo_make" },
      }, null, 2),
    )

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          yield* skill.all()
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      // Verify skill_config.json was NOT created by fallback
      const exists = await fs.stat(path.join(octoConfigDir, "skill_config.json")).then(() => true).catch(() => false)
      expect(exists).toBe(false)
    } finally {
      await cleanup()
    }
  })

  test("fallback handles common type by adding to all agents", async () => {
    const { ctx, cleanup } = await setupTest([
      { dirName: "common-helper", name: "common-helper", desc: "A common helper skill" },
    ])

    await fs.rm(path.join(octoConfigDir, "skill_config.json"), { force: true })
    await fs.writeFile(
      path.join(octoConfigDir, "skills.json"),
      JSON.stringify({
        "common-helper": { description: "A common helper skill", import: true, type: "common" },
      }, null, 2),
    )

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service

          for (const agentName of ["octo_insight", "octo_make", "octo_studio"]) {
            const skills = yield* skill.available(makeAgent(agentName))
            expect(skills.map((s) => s.name)).toContain("common-helper")
          }
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await cleanup()
    }
  })

  test("fallback skips skills with import=false", async () => {
    const { ctx, cleanup } = await setupTest([
      { dirName: "disabled-skill", name: "disabled-skill", desc: "A disabled skill" },
    ])

    await fs.rm(path.join(octoConfigDir, "skill_config.json"), { force: true })
    await fs.writeFile(
      path.join(octoConfigDir, "skills.json"),
      JSON.stringify({
        "disabled-skill": { description: "A disabled skill", import: false, type: "octo_make" },
      }, null, 2),
    )

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer, noopBootstrap),
    )

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const skills = yield* skill.available(makeAgent("octo_make"))
          expect(skills.find((s) => s.name === "disabled-skill")).toBeUndefined()
        }).pipe(Effect.provideService(InstanceRef, ctx)),
      )
    } finally {
      await cleanup()
    }
  })
})