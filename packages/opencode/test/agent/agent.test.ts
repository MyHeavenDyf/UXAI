import { afterEach, test, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Global } from "@opencode-ai/core/global"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

// 带 pattern 的求值(SPEC-INS-032 §5.2:task 的候选白/黑名单是 pattern 级的)
function evalPermPattern(
  agent: Agent.Info | undefined,
  permission: string,
  pattern: string,
): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, pattern, agent.permission).action
}

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).toContain("octo_ai")
      expect(names).toContain("plan")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    },
  })
})

test("octo_ai agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai).toBeDefined()
      expect(octo_ai?.mode).toBe("primary")
      expect(octo_ai?.native).toBe(true)
      expect(evalPerm(octo_ai, "edit")).toBe("allow")
      expect(evalPerm(octo_ai, "bash")).toBe("allow")
    },
  })
})

test("plan agent denies edits except .opencode/plans/*", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      // Wildcard is denied
      expect(evalPerm(plan, "edit")).toBe("deny")
      // But specific path is allowed
      expect(Permission.evaluate("edit", ".opencode/plans/foo.md", plan!.permission).action).toBe("allow")
    },
  })
})

test("explore agent denies edit and write", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
      expect(evalPerm(explore, "edit")).toBe("deny")
      expect(evalPerm(explore, "write")).toBe("deny")
      expect(evalPerm(explore, "todowrite")).toBe("deny")
    },
  })
})

test("explore agent asks for external directories and allows whitelisted external paths", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeDefined()
      expect(Permission.evaluate("external_directory", "/some/other/path", explore!.permission).action).toBe("ask")
      expect(Permission.evaluate("external_directory", Truncate.GLOB, explore!.permission).action).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(Global.Path.tmp, "agent-work"), explore!.permission).action,
      ).toBe("allow")
    },
  })
})

test("general agent denies todo tools", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const general = await load(tmp.path, (svc) => svc.get("general"))
      expect(general).toBeDefined()
      expect(general?.mode).toBe("subagent")
      expect(general?.hidden).toBeUndefined()
      expect(evalPerm(general, "todowrite")).toBe("deny")
    },
  })
})

test("compaction agent denies all permissions", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const compaction = await load(tmp.path, (svc) => svc.get("compaction"))
      expect(compaction).toBeDefined()
      expect(compaction?.hidden).toBe(true)
      expect(evalPerm(compaction, "bash")).toBe("deny")
      expect(evalPerm(compaction, "edit")).toBe("deny")
      expect(evalPerm(compaction, "read")).toBe("deny")
    },
  })
})

test("custom agent from config creates new agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_custom_agent: {
          model: "openai/gpt-4",
          description: "My custom agent",
          temperature: 0.5,
          top_p: 0.9,
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const custom = await load(tmp.path, (svc) => svc.get("my_custom_agent"))
      expect(custom).toBeDefined()
      expect(String(custom?.model?.providerID)).toBe("openai")
      expect(String(custom?.model?.modelID)).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    },
  })
})

test("custom agent config overrides native agent properties", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          model: "anthropic/claude-3",
          description: "Custom octo_ai agent",
          temperature: 0.7,
          color: "#FF0000",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai).toBeDefined()
      expect(String(octo_ai?.model?.providerID)).toBe("anthropic")
      expect(String(octo_ai?.model?.modelID)).toBe("claude-3")
      expect(octo_ai?.description).toBe("Custom octo_ai agent")
      expect(octo_ai?.temperature).toBe(0.7)
      expect(octo_ai?.color).toBe("#FF0000")
      expect(octo_ai?.native).toBe(true)
    },
  })
})

test("agent disable removes agent from list", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { disable: true },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeUndefined()
      const agents = await load(tmp.path, (svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("explore")
    },
  })
})

test("agent permission config merges with defaults", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          permission: {
            bash: {
              "rm -rf *": "deny",
            },
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai).toBeDefined()
      // Specific pattern is denied
      expect(Permission.evaluate("bash", "rm -rf *", octo_ai!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(octo_ai, "edit")).toBe("allow")
    },
  })
})

test("global permission config applies to all agents", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: "deny",
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai).toBeDefined()
      expect(evalPerm(octo_ai, "bash")).toBe("deny")
    },
  })
})

test("agent steps/maxSteps config sets steps property", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: { steps: 50 },
        plan: { maxSteps: 100 },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(octo_ai?.steps).toBe(50)
      expect(plan?.steps).toBe(100)
    },
  })
})

test("agent mode can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { mode: "primary" },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore?.mode).toBe("primary")
    },
  })
})

test("agent name can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: { name: "Builder" },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai?.name).toBe("Builder")
    },
  })
})

test("agent prompt can be set from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: { prompt: "Custom system prompt" },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai?.prompt).toBe("Custom system prompt")
    },
  })
})

test("unknown agent properties are placed into options", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai?.options.random_property).toBe("hello")
      expect(octo_ai?.options.another_random).toBe(123)
    },
  })
})

test("agent options merge correctly", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          options: {
            custom_option: true,
            another_option: "value",
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(octo_ai?.options.custom_option).toBe(true)
      expect(octo_ai?.options.another_option).toBe("value")
    },
  })
})

test("multiple custom agents can be defined", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        agent_a: {
          description: "Agent A",
          mode: "subagent",
        },
        agent_b: {
          description: "Agent B",
          mode: "primary",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agentA = await load(tmp.path, (svc) => svc.get("agent_a"))
      const agentB = await load(tmp.path, (svc) => svc.get("agent_b"))
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    },
  })
})

test("Agent.list keeps the default agent first and sorts the rest by name", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "plan",
      agent: {
        zebra: {
          description: "Zebra",
          mode: "subagent",
        },
        alpha: {
          description: "Alpha",
          mode: "subagent",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const names = (await load(tmp.path, (svc) => svc.list())).map((a) => a.name)
      expect(names[0]).toBe("plan")
      expect(names.slice(1)).toEqual(names.slice(1).toSorted((a, b) => a.localeCompare(b)))
    },
  })
})

test("Agent.get returns undefined for non-existent agent", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const nonExistent = await load(tmp.path, (svc) => svc.get("does_not_exist"))
      expect(nonExistent).toBeUndefined()
    },
  })
})

test("default permission includes doom_loop and external_directory as ask", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(evalPerm(octo_ai, "doom_loop")).toBe("ask")
      expect(evalPerm(octo_ai, "external_directory")).toBe("ask")
    },
  })
})

// SPEC-INS-021 §1:octo_insight 工具白名单(deny = 隐藏 + 阻断,双层生效)
test("octo_insight denies escape-hatch tools and keeps analysis toolset", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const insight = await load(tmp.path, (svc) => svc.get("octo_insight"))
      expect(insight).toBeDefined()
      // deny 清单(edit/apply_patch 不在权限层——EDIT_TOOLS 共享 "edit" 权限键,deny 会连带
      // 隐藏要保留的 write,改在 registry.ts tools() 按 agent 裁剪;权限层 edit 维持 defaults allow
      // 以保 write 的执行链路)
      //
      // 2026-07-30 起 bash / todowrite 已在权限层放开(bash 供 interview-analysis skill,
      // todowrite 是 skill 多步执行的进度载体),断言随之更新 —— bash 的"逃生口"关闭改由
      // chip turn 的 buildToolGate 单点负责,不再靠常驻 deny。
      expect(evalPerm(insight, "bash")).toBe("allow")
      expect(evalPerm(insight, "edit")).toBe("allow")
      expect(evalPerm(insight, "todowrite")).toBe("allow")
      expect(evalPerm(insight, "jimeng_image_generate")).toBe("deny")
      expect(evalPerm(insight, "internel_image_generate")).toBe("deny")
      // 保留集(webfetch/websearch 经 2026-07-11 spec 修订保留)
      expect(evalPerm(insight, "extract_document")).toBe("allow")
      expect(evalPerm(insight, "read")).toBe("allow")
      expect(evalPerm(insight, "grep")).toBe("allow")
      expect(evalPerm(insight, "glob")).toBe("allow")
      expect(evalPerm(insight, "write")).toBe("allow")
      expect(evalPerm(insight, "task")).toBe("allow")
      expect(evalPerm(insight, "skill")).toBe("allow")
      expect(evalPerm(insight, "webfetch")).toBe("allow")
      expect(evalPerm(insight, "websearch")).toBe("allow")
      // 外部目录询问不放宽(SPEC-INS-021 §2)
      expect(evalPerm(insight, "external_directory")).toBe("ask")
    },
  })
})

// 用例意图 = 「全局 defaults 不禁 webfetch」。原先拿 octo_ai 验,但 octo_ai 自己显式 deny 了
// webfetch(见 agent.ts 的 octo_ai 条目),断言与配置长期打架。改用不覆盖该键的 general 验默认值,
// 并顺带把 octo_ai 的显式 deny 也钉住 —— 两条各测各的,不再互相冒充。
test("webfetch is allowed by default", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const general = await load(tmp.path, (svc) => svc.get("general"))
      expect(evalPerm(general, "webfetch")).toBe("allow")
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(evalPerm(octo_ai, "webfetch")).toBe("deny")
    },
  })
})

test("legacy tools config converts to permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          tools: {
            bash: false,
            read: false,
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(evalPerm(octo_ai, "bash")).toBe("deny")
      expect(evalPerm(octo_ai, "read")).toBe("deny")
    },
  })
})

test("legacy tools config maps write/edit/patch to edit permission", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          tools: {
            write: false,
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(evalPerm(octo_ai, "edit")).toBe("deny")
    },
  })
})

test("Truncate.GLOB is allowed even when user denies external_directory globally", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, octo_ai!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, octo_ai!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", octo_ai!.permission).action).toBe("deny")
    },
  })
})

test("global tmp directory children are allowed for external_directory", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(
        Permission.evaluate("external_directory", path.join(Global.Path.tmp, "scratch"), octo_ai!.permission).action,
      ).toBe("allow")
      expect(Permission.evaluate("external_directory", "/some/other/path", octo_ai!.permission).action).toBe("ask")
    },
  })
})

test("Truncate.GLOB is allowed even when user denies external_directory per-agent", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      agent: {
        octo_ai: {
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, octo_ai!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, octo_ai!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", octo_ai!.permission).action).toBe("deny")
    },
  })
})

test("explicit Truncate.GLOB deny is respected", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.GLOB]: "deny",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
    },
  })
})

test("skill directories are allowed for external_directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "perm-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: perm-skill
description: Permission skill.
---

# Permission Skill
`,
      )
    },
  })

  const home = process.env.OCTO_TEST_HOME
  process.env.OCTO_TEST_HOME = tmp.path

  try {
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const octo_ai = await load(tmp.path, (svc) => svc.get("octo_ai"))
        const skillDir = path.join(tmp.path, ".opencode", "skill", "perm-skill")
        const target = path.join(skillDir, "reference", "notes.md")
        expect(Permission.evaluate("external_directory", target, octo_ai!.permission).action).toBe("allow")
      },
    })
  } finally {
    process.env.OCTO_TEST_HOME = home
  }
})

test("defaultAgent returns octo_ai when no default_agent config", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      expect(agent).toBe("octo_ai")
    },
  })
})

test("defaultAgent rejects hidden agents set as default_agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "plan", // plan is hidden
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow('default agent "plan" is hidden')
    },
  })
})

test("defaultAgent respects default_agent config set to custom agent with mode all", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "my_custom",
      agent: {
        my_custom: {
          description: "My custom agent",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      expect(agent).toBe("my_custom")
    },
  })
})

test("defaultAgent throws when default_agent points to subagent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "explore",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow('default agent "explore" is a subagent')
    },
  })
})

test("defaultAgent throws when default_agent points to hidden agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "compaction",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow('default agent "compaction" is hidden')
    },
  })
})

test("defaultAgent throws when default_agent points to non-existent agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "does_not_exist",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow(
        'default agent "does_not_exist" not found',
      )
    },
  })
})

test("defaultAgent returns octo_ai when plan is disabled and default_agent not set", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        plan: { disable: true },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      // plan is disabled, octo_ai is the default
      expect(agent).toBe("octo_ai")
    },
  })
})

test("defaultAgent throws when all primary agents are disabled", async () => {
  // primary agent 清单**动态取**、不写死:本仓陆续加了 octo_make_plan / octo_pattern_* / proto_* 等
  // 一批 primary agent,原先硬编码那 6 个已盖不全 —— 漏掉的那些仍可见,defaultAgent() 照样返回,
  // 用例就此长期失败(陈旧断言)。改成先列一遍再全禁,新增 agent 时自动跟上。
  await using probe = await tmpdir()
  const primaries = await WithInstance.provide({
    directory: probe.path,
    fn: async () => {
      const agents = await load(probe.path, (svc) => svc.list())
      return agents.filter((a) => a.mode === "primary").map((a) => a.name)
    },
  })
  expect(primaries.length).toBeGreaterThan(0)

  await using tmp = await tmpdir({
    config: { agent: Object.fromEntries(primaries.map((name) => [name, { disable: true }])) },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow("no primary visible agent found")
    },
  })
})

test("backward compat: config key 'build' maps to octo_ai", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          model: "anthropic/claude-3",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.get("octo_ai"))
      expect(agent).toBeDefined()
      expect(String(agent?.model?.providerID)).toBe("anthropic")
    },
  })
})

test("backward compat: get('build') returns octo_ai agent", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.get("build"))
      expect(agent).toBeDefined()
      expect(agent?.name).toBe("octo_ai")
    },
  })
})

// ── SPEC-INS-032:子代理分治 ────────────────────────────────────────────────

// §3.3:extract_document 的可见性从 registry 的 agent 名硬编码搬到权限层声明。
// defaults 默认 deny,需要的 agent 显式 allow —— 这条用例就是那个 gate 的新家。
test("SPEC-INS-032: extract_document is opt-in via permission, not registry agent name", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const insight = await load(tmp.path, (svc) => svc.get("octo_insight"))
      const reader = await load(tmp.path, (svc) => svc.get("insight_reader"))
      const general = await load(tmp.path, (svc) => svc.get("general"))
      const make = await load(tmp.path, (svc) => svc.get("octo_make"))
      expect(evalPerm(insight, "extract_document")).toBe("allow")
      expect(evalPerm(reader, "extract_document")).toBe("allow")
      // 默认不给:pattern "*" 的 deny → Permission.disabled 既隐藏也阻断
      expect(evalPerm(general, "extract_document")).toBe("deny")
      expect(evalPerm(make, "extract_document")).toBe("deny")
      expect(Permission.disabled(["extract_document"], general!.permission).has("extract_document")).toBe(true)
      expect(Permission.disabled(["extract_document"], insight!.permission).has("extract_document")).toBe(false)
    },
  })
})

// §4.1:子代理只读 —— 不给 write/edit(EDIT_TOOLS 共键,用 edit 一把关)、bash、task(防套娃)、skill。
test("SPEC-INS-032: insight_reader is a read-only subagent", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const reader = await load(tmp.path, (svc) => svc.get("insight_reader"))
      expect(reader).toBeDefined()
      expect(reader?.mode).toBe("subagent")
      expect(reader?.description).toBeTruthy()
      expect(evalPerm(reader, "read")).toBe("allow")
      expect(evalPerm(reader, "grep")).toBe("allow")
      expect(evalPerm(reader, "glob")).toBe("allow")
      expect(evalPerm(reader, "edit")).toBe("deny")
      expect(evalPerm(reader, "bash")).toBe("deny")
      expect(evalPerm(reader, "task")).toBe("deny")
      expect(evalPerm(reader, "skill")).toBe("deny")
      // 写盘三件套共用 "edit" 权限键,一条 deny 应当把它们全部隐藏
      const off = Permission.disabled(["write", "edit", "apply_patch", "task"], reader!.permission)
      expect(off.has("write")).toBe(true)
      expect(off.has("edit")).toBe(true)
      expect(off.has("apply_patch")).toBe(true)
      expect(off.has("task")).toBe(true)
      // 子代理不绑 MCP(prompt.ts 只给显式声明 mcp 的 agent 发内置 MCP 工具)
      expect(reader?.mcp).toBeUndefined()
    },
  })
})

// §5.2:insight_reader 只出现在 insight 的 task 候选里(describeTask 按 evaluate("task", <名>) 过滤),
// 且这条 pattern 级 deny **不得**把其他 agent 的 task 工具本身关掉 —— 两个函数语义不同,一起钉住。
test("SPEC-INS-032: insight_reader is only a task candidate for octo_insight", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const insight = await load(tmp.path, (svc) => svc.get("octo_insight"))
      const make = await load(tmp.path, (svc) => svc.get("octo_make"))
      const ai = await load(tmp.path, (svc) => svc.get("octo_ai"))

      expect(evalPermPattern(insight, "task", "insight_reader")).toBe("allow")
      expect(evalPermPattern(make, "task", "insight_reader")).toBe("deny")
      // 别的 subagent 候选不受影响
      expect(evalPermPattern(make, "task", "general")).toBe("allow")
      expect(evalPermPattern(insight, "task", "general")).toBe("allow")

      // 关键回归:pattern 级 deny 不等于关掉 task 工具(Permission.disabled 只认 pattern "*" 的 deny)
      expect(Permission.disabled(["task"], make!.permission).has("task")).toBe(false)
      expect(Permission.disabled(["task"], insight!.permission).has("task")).toBe(false)
      // octo_ai 自己整体 deny 了 task,仍应被隐藏(不受本次改动影响)
      expect(Permission.disabled(["task"], ai!.permission).has("task")).toBe(true)
    },
  })
})
