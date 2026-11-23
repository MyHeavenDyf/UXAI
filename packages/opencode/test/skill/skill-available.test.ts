import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Ripgrep } from "../../src/file/ripgrep"
import { Discovery } from "../../src/skill/discovery"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// 不能用 Skill.defaultLayer:它内嵌 Global.layer,octoConfig 会指向本机 ~/.config/octo
// (真实 skill_config.json 白名单 + skill 目录),available() 的断言就被机器状态污染。
// 这里重组 defaultLayer 的依赖链,把 octoConfig 与 home 都指到测试 tmp 内。
const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(node))

// available() 只读 name/permission 两个字段,最小构造避免耦合 Agent.Info 完整 schema
const agentInfo = (name: string): Agent.Info => ({ name, permission: [] }) as unknown as Agent.Info

const skillMd = (name: string) => `---
name: ${name}
description: Test skill ${name}.
---

# ${name}
`

describe("skill available", () => {
  it.live(
    "filters by agentConfig whitelist, AGENT_SKILL_ALIASES and no-agent fallback",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const octoConfig = path.join(dir, "octo-config")
        const home = path.join(dir, "home")
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(octoConfig, "skill", "alpha-skill", "SKILL.md"), skillMd("alpha-skill")),
            Bun.write(path.join(octoConfig, "skill", "beta-skill", "SKILL.md"), skillMd("beta-skill")),
            Bun.write(
              path.join(octoConfig, "skill_config.json"),
              JSON.stringify({
                skill: {},
                agent: { octo_make: ["alpha-skill"] },
              }),
            ),
          ]),
        )

        const layer = Skill.layer.pipe(
          Layer.provide(Discovery.defaultLayer),
          Layer.provide(Config.defaultLayer),
          Layer.provide(Bus.layer),
          Layer.provide(AppFileSystem.defaultLayer),
          Layer.provide(Global.layerWith({ octoConfig, home })),
          Layer.provide(Ripgrep.defaultLayer),
        )

        const result = yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          return {
            noAgent: yield* skill.available(),
            octoMake: yield* skill.available(agentInfo("octo_make")),
            octoAI: yield* skill.available(agentInfo("octo_ai")),
            proto: yield* skill.available(agentInfo("proto_replanner")),
          }
        }).pipe(Effect.provide(layer))

        expect(result.noAgent.map((s) => s.name)).toEqual(expect.arrayContaining(["alpha-skill", "beta-skill"]))
        expect(result.octoMake.map((s) => s.name)).toEqual(["alpha-skill"])
        expect(result.octoAI).toEqual([])
        // proto_* 走 AGENT_SKILL_ALIASES 继承 octo_make 的白名单
        expect(result.proto.map((s) => s.name)).toEqual(["alpha-skill"])
      }),
    ),
  )
})
