import { Config } from "@/config/config"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_OCTO_INSIGHT from "./prompt/octo_insight.txt"
import PROMPT_INSIGHT_READER from "./prompt/insight_reader.txt"
import PROMPT_OCTO_MAKE from "./prompt/octo_make.txt"
import PROMPT_OCTO_DESIGN from "./prompt/octo_design.txt"
import PROMPT_OCTO_STUDIO from "./prompt/octo_studio.txt"
import PROMPT_OCTO_PATTERN_INTENT from "./prompt/octo_pattern_intent.txt"
import PROMPT_OCTO_PATTERN_MODULE from "./prompt/octo_pattern_module.txt"
import PROMPT_ICT_PATTERN from "./prompt/ict_pattern.txt"
import PROMPT_MAKE_COMPONENT from "./prompt/make_component.txt"
import PROMPT_OCTO_MAKE_PLAN from "./prompt/octo_make_plan.txt"
import {
  PROMPT_PROTO_INTENT,
  PROMPT_PROTO_INTENT_AUDIT,
  PROMPT_PROTO_MODULE_CREATE,
  PROMPT_PROTO_MODULE_MODIFY,
  PROMPT_PROTO_PLANNER_CREATE,
  PROMPT_PROTO_PLANNER_MODIFY,
  PROMPT_PROTO_TRIAGE,
  PROMPT_PROTO_PATTERN_PAGE,
  PROMPT_PROTO_PATTERN_BLOCK,
  PROMPT_PROTO_INTENT_CONFIRM,
  PROMPT_PROTO_WFRAMES,
  PROMPT_PROTO_MODIFY,
  PROMPT_PROTO_REPLANNER,
} from "./proto"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { zod } from "@/util/effect-zod"
import { withStatics, type DeepMutable } from "@/util/schema"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
  skills: Schema.optional(Schema.Array(Schema.String)),
  mcp: Schema.optional(Schema.Array(Schema.String)),
})
  .annotate({ identifier: "Agent" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<{
    identifier: string
    whenToUse: string
    systemPrompt: string
  }>
}

type State = Omit<Interface, "generate">

export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") { }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
          // 全局 skill 根目录（外部目录白名单仅取一层，这里补全递归路径）
          path.join(Global.Path.octoConfig, "skill", "**"),
        ]

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          load_components_docs: "deny",
          // SPEC-INS-032 §3:文档抽取默认不给任何 agent,需要的 agent(octo_insight / insight_reader,
          // 以及第三方 skill 自带的 agent md)在自己的配置里显式 allow。
          // 这取代了原先 registry.ts 里 `agent.name === "octo_insight"` 那条硬编码 gate ——
          // 声明式(agent 声明自己要什么工具)是上游既定机制,`permission` 就是它;
          // 上游 config 的 `tools: { x: true }` 亦会被 normalize 翻译成本形态(config/agent.ts)。
          // 语义:Permission.disabled 对 pattern "*" 的 deny **既隐藏工具也阻断执行**。
          extract_document: "deny",
          // SPEC-INS-032 §5.2:insight_reader 是 insight 专用子代理,不该出现在其他 agent 的
          // task 候选清单里(registry.describeTask 按 evaluate("task", <agent 名>) 过滤)。
          // 注意这里**必须**用 pattern 形态而不是整体 deny —— Permission.disabled 只在
          // 「最后匹配规则 pattern === "*" 且 deny」时隐藏工具,故本条不会关掉其他 agent 的 task 本身。
          task: { insight_reader: "deny" },
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          // SPEC-INS-030:chat 下线后 octo_ai 只剩「build 的向后兼容目标 + TUI 默认 agent」两个身份,
          // 原 octo_ai.txt 是套用的编码 agent 模板(且带内网知识库段,该能力已迁 octo_insight),故整份丢弃。
          // 不给 prompt 字段 → session/llm.ts 回落 SystemPrompt.provider(按模型选 anthropic/gpt/… 默认),
          // 正是上游 build agent 的原始行为。agent 本体保留:删它会波及 build 映射 / plan.ts / TUI / 上游 ui。
          octo_ai: {
            name: "octo_ai",
            description: "The default agent. Executes tools based on configured permissions.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                task: "deny",
                todowrite: "deny",
                webfetch: "deny",
                websearch: "deny",
                jimeng_image_generate: "deny",
                internel_image_generate: "deny",
                lsp: "deny",
                skill: "deny",
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          plan: {
            name: "plan",
            description: "Plan mode. Disallows all edit tools.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".opencode", "plans", "*.md")]: "allow",
                  ...(ctx.worktree
                    ? {
                        [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                      }
                    : {}),
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
            hidden: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                external_directory: {
                  "*": "ask",
                  ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
                },
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          make_component: {
            name: "make_component",
            description:
              "HTML component generator. Generates a single self-contained HTML fragment for a specified UI component, following design system tokens.",
            prompt: PROMPT_MAKE_COMPONENT,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                task: "deny",
                todowrite: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          octo_insight: {
            name: "octo_insight",
            description:
              "用研 Agent，从访谈材料中提取结构化洞察。支持多维度分析（关键发现/按提纲聚类/用户画像/评估/思维导图/知识问答）。",
            prompt: PROMPT_OCTO_INSIGHT,
            // SPEC-INS-021 §1 工具白名单:deny 即"从模型工具列表隐藏 + 阻断执行"。
            // 常驻可见集收敛为 extract_document/read/grep/glob/write/edit/task/skill/webfetch/websearch/
            // bash/todowrite(+ MCP 查询/终止)。
            //   - task 保留给多文档分治,chip turn 由 buildToolGate 临时关 task/bash/webfetch。
            //   - bash 原为弱模型在 MCP 断连时模拟调用的逃生口(2026-07-07 内网事故)而常驻关死;
            //     现因 interview-analysis skill 步骤需要 shell 而在权限层放开(普通轮次可用)。
            //     chip turn(研究工具那轮)仍由 buildToolGate 关死 bash——那轮只该单次直调所选 MCP 工具,
            //     shell 无正当用途、正是逃生口高发场景,故 chip turn 的关闭从"冗余"升为"唯一守卫"。
            //   - edit(2026-07-30 放开,供编辑 md 交付物)/apply_patch(仍摘)的裁剪**不在这里**:
            //     Permission.disabled 把 edit/write/apply_patch 都映射到 "edit" 权限键(EDIT_TOOLS),
            //     在权限层动 edit 会连带隐藏要保留的 write,故编辑类工具一律在 registry.ts tools() 按
            //     agent 裁剪;放开 edit 后 outputs 重定向插件已同步覆盖 edit 的 filePath。
            // merge 顺序 defaults → 本 deny → user:用户配置仍可覆盖。
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                // bash 放开供 interview-analysis skill 使用(原 2026-07-07 事故后常驻 deny);
                // chip turn 的 bash 仍由 buildToolGate 关闭,详见上方白名单注释。
                bash: "allow",
                // todowrite 2026-07-30 放开:待办清单是 skill 多步执行的进度载体;权限层无耦合。
                jimeng_image_generate: "deny",
                internel_image_generate: "deny",
                // SPEC-INS-025:question 在上方 defaults 里是 "deny"(全局默认对所有 agent 关闭,
                // 只有 plan agent 显式 allow),不在这里翻开的话模型的工具列表里根本没有它
                // ——现象是模型回「我没有名为 question 的工具」,而不是调用后卡住。
                // insight 需要它向用户提问(如知识库问答让用户选库),故显式放开;
                // 答题 UI 见 pages/insight/components/question-dock.tsx。
                question: "allow",
                // SPEC-INS-032 §3.3:文档抽取在 defaults 里默认 deny,这里显式放开。
                extract_document: "allow",
                // SPEC-INS-032 §5:多文档通读的分治入口 —— defaults 对所有 agent deny 了
                // insight_reader 这个候选,只有 insight 这条线放开(pattern 形态,不影响 task 工具本身)。
                //
                // v2(2026-08-21 评审补):**候选必须真收敛到 insight_reader**。此前只写了
                // `{ insight_reader: "allow" }`,而 describeTask 列的是「所有未被 deny 的 subagent」,
                // 于是 `general`(bash / write / webfetch 全开、prompt 是通用助理导向)和 `explore`
                // 仍在 insight 的候选里 —— 弱模型完全可能派 general 去读用研材料。spec §5.1 那句
                // 「候选只有一个只读的文档子代理,派错了也干不了坏事」在补这条之前并不成立。
                //
                // 顺序有意义,别调换:fromConfig 按 Object.entries 顺序生成规则,而
                // Permission.disabled 用 findLast 取**最后一条**匹配 `task` 的规则、仅当它
                // `pattern === "*" && deny` 时才隐藏工具。`insight_reader: "allow"` 排在
                // `"*": "deny"` 之后 → 最后一条 pattern 是 insight_reader → task 工具照常可用。
                // 反过来写就会把 insight 的 task 整个关掉。单测锁住(agent.test.ts)。
                task: { "*": "deny", insight_reader: "allow" },
              }),
              user,
            ),
            options: {},
            mode: "primary",
            native: false,
            skills: ["interview-analysis"],
            mcp: ["uxr-tool"],
          },
          // SPEC-INS-032:多文档通读的分治子代理 —— 一份材料一个子会话,读完只回传结论。
          // 价值是**上下文隔离**不是并发(串行同样能把父上下文从十几万 token 压到几千)。
          // 工具面刻意只留「读」:不给 write/edit/bash(产物一律由父代理落盘,避免并发写同名文件
          // 互相覆盖)、不给 task(它是最末一层,防套娃)、不绑 mcp。
          // 名字用「归属_角色」而非 *_subagent:mode 字段与会话 category 已表达「是子代理」,
          // 而这个名字既是模型选 subagent_type 的依据、也直接显示在 UI 的 task 卡片上。
          insight_reader: {
            name: "insight_reader",
            description:
              "读一份用研材料(docx / pdf / xlsx / pptx / txt / md)并回传结论。用于多份文档的通读类任务:一份文档派一个,读完只回结论、不写文件。需要在任务里给出文件的本地绝对路径和要提炼什么。",
            prompt: PROMPT_INSIGHT_READER,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                extract_document: "allow",
                // 用 edit 键一把关掉 edit/write/apply_patch:上游 Permission.disabled 把这三个工具
                // 都映射到 "edit" 权限键(EDIT_TOOLS),写 `write: "deny"` 是不生效的。
                // 021 §1 把这个映射当坑记(它想留 write),这里正好相反 —— 子代理本就一个都不该有。
                edit: "deny",
                bash: "deny",
                task: "deny",
                todowrite: "deny",
                webfetch: "deny",
                websearch: "deny",
                skill: "deny",
                jimeng_image_generate: "deny",
                internel_image_generate: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: false,
          },
          octo_make: {
            name: "octo_make",
            description:
              "Web design prototyping specialist. Creates high-fidelity interactive HTML prototypes using Tailwind CSS.",
            prompt: PROMPT_OCTO_MAKE,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                write: "allow",
                edit: {
                  "*": "ask",
                  "**/.config/octo/skill/**": "allow",
                },
                todowrite: "deny",
                websearch: "deny",
                jimeng_image_generate: "deny",
                internel_image_generate: "deny",
                lsp: "deny",
                plan_exit: "deny",
                question: "deny",
              }),
              user,
            ),
            options: {},
            mode: "primary",
            native: false,
            skills: ["html-prototype"],
            mcp: ["prototype-dev"],
          },
          octo_make_plan: {
            name: "octo_make_plan",
            description: "设计规划专家。根据用户需求产出一份结构化设计策略文档，包含设计需求、洞察研究、设计资产等模块。",
            prompt: PROMPT_OCTO_MAKE_PLAN,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "ask",
                websearch: "allow",
              }),
              user,
            ),
            options: {},
            mode: "primary",
            native: true,
            hidden: true,
          },
          octo_design: {
            name: "octo_design",
            description: "UI design specialist. Generates and edits .pix design files using Pixso MCP tools.",
            prompt: PROMPT_OCTO_DESIGN,
            permission: Permission.merge(defaults, user),
            options: {},
            mode: "primary",
            native: false,
            skills: ["design-basics"],
            mcp: ["pixso-design"],
          },
          octo_studio: {
            name: "octo_studio",
            description:
              "Studio image creation specialist. Generates images via Jimeng/Internal tools and creative assets.",
            prompt: PROMPT_OCTO_STUDIO,
            permission: Permission.merge(defaults, user),
            options: {},
            mode: "primary",
            native: false,
            skills: ["creative-assets"],
          },
          octo_pattern_intent: {
            name: "octo_pattern_intent",
            description:
              "A2UI generative UI specialist. Analyzes user requirements, expands into structured blueprints, and produces A2UI JSON documents.",
            prompt: PROMPT_OCTO_PATTERN_INTENT,
            permission: Permission.merge(defaults, user),
            options: {},
            mode: "primary",
            native: false,
          },
          octo_pattern_module: {
            name: "octo_pattern_module",
            description: "Pattern module creation agent. Generates A2UI JSON from Pattern description blueprints.",
            prompt: PROMPT_OCTO_PATTERN_MODULE,
            permission: Permission.merge(defaults, user),
            options: {},
            mode: "primary",
            native: false,
            hidden: true,
          },
          ict_pattern: {
            name: "ict_pattern",
            description:
              "ICT Pattern specialist. Single agent, two stages routed by an input marker: plain page description input runs stage 1 (match Pattern layouts, output results); input starting with the [模块匹配] marker (assembled by the caller after the user picks a pattern in the UI) runs stage 2 (generate module description list, output modules).",
            prompt: PROMPT_ICT_PATTERN,
            permission: Permission.fromConfig({ "*": "deny" }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
          proto_intent: {
            name: "proto_intent",
            description: "Proto intent specialist agent.",
            prompt: PROMPT_PROTO_INTENT,
            permission: Permission.fromConfig({
              "*": "deny",
            }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.2,
          },
          proto_intent_audit: {
            name: "proto_intent_audit",
            description: "Proto intent audit agent.",
            prompt: PROMPT_PROTO_INTENT_AUDIT,
            permission: Permission.fromConfig({
              "*": "deny",
            }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.4,
          },
          proto_module_create: {
            name: "proto_module_create",
            description: "Proto module create agent.",
            prompt: PROMPT_PROTO_MODULE_CREATE,
            permission: Permission.fromConfig({ "*": "deny", load_components_docs: "allow" }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.0,
          },
          proto_module_modify: {
            name: "proto_module_modify",
            description: "Proto module modify agent.",
            prompt: PROMPT_PROTO_MODULE_MODIFY,
            permission: Permission.fromConfig({ "*": "deny", load_components_docs: "allow" }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.0,
          },
          proto_planner_create: {
            name: "proto_planner_create",
            description: "Proto planner create agent.",
            prompt: PROMPT_PROTO_PLANNER_CREATE,
            permission: Permission.fromConfig({
              "*": "deny",
            }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.0,
          },
          proto_planner_modify: {
            name: "proto_planner_modify",
            description: "Proto planner modify agent.",
            prompt: PROMPT_PROTO_PLANNER_MODIFY,
            permission: Permission.fromConfig({
              "*": "deny",
            }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.0,
          },
          proto_triage: {
            name: "proto_triage",
            description: "Proto triage agent.",
            prompt: PROMPT_PROTO_TRIAGE,
            permission: Permission.fromConfig({ "*": "deny" }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          proto_pattern_page: {
            name: "proto_pattern_page",
            description: "Proto page pattern agent.",
            prompt: PROMPT_PROTO_PATTERN_PAGE,
            permission: Permission.fromConfig({ "*": "deny"}),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          proto_pattern_block: {
            name: "proto_pattern_block",
            description: "Proto block pattern agent.",
            prompt: PROMPT_PROTO_PATTERN_BLOCK,
            permission: Permission.fromConfig({ "*": "deny"}),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          proto_intent_confirm: {
            name: "proto_intent_confirm",
            description: "Proto intent confirm agent.",
            prompt: PROMPT_PROTO_INTENT_CONFIRM,
            permission: Permission.fromConfig({ "*": "deny"}),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          proto_wireframes: {
            name: "proto_wireframes",
            description: "Proto wireframes agent.",
            prompt: PROMPT_PROTO_WFRAMES,
            permission: Permission.fromConfig({ "*": "deny"}),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          proto_modify: {
            name: "proto_modify",
            description: "Proto modify agent.",
            prompt: PROMPT_PROTO_MODIFY,
            permission: Permission.fromConfig({ "*": "deny", load_components_docs: "allow" }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.1,
          },
          proto_replanner: {
            name: "proto_replanner",
            description: "Proto replanner agent — reverse-engineers macro-layout from final A2UI JSON.",
            prompt: PROMPT_PROTO_REPLANNER,
            permission: Permission.fromConfig({
              "*": "deny",
            }),
            options: {},
            mode: "primary",
            native: false,
            temperature: 0.0,
          },
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          // Backward compat: map legacy "build" key to "octo_ai"
          const resolvedKey = key === "build" ? "octo_ai" : key
          if (value.disable) {
            delete agents[resolvedKey]
            continue
          }
          let item = agents[resolvedKey]
          if (!item)
            item = agents[resolvedKey] = {
              name: resolvedKey,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.skills = value.skills ?? item.skills
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          // Backward compat: "build" → "octo_ai"
          const resolved = agent === "build" ? "octo_ai" : agent
          return agents[resolved]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "octo_ai"), "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            // Backward compat: "build" → "octo_ai"
            const resolved = c.default_agent === "build" ? "octo_ai" : c.default_agent
            const agent = agents[resolved]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent.name
          }
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible.name
        })

        return {
          get,
          list,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                (item): ModelMessage => ({
                  role: "system",
                  content: item,
                }),
              )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: z.object({
            identifier: z.string(),
            whenToUse: z.string(),
            systemPrompt: z.string(),
          }),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => { },
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Agent from "./agent"
