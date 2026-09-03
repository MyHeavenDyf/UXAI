/**
 * scene_3d_plan —— 3D codegen 3-agent 之「规划」
 * 调 list_3d_components / get_3d_component_doc 浏览组件库，为 triage 的 type 清单选型
 * （native / component / model + 依赖组件 / 资源）+ 定 camera / lights / scene。
 * 产物（plan JSON）注入 codegen agent 的 [PLAN_JSON]。schema 约束输出结构。
 */
import { extractJson, extractJsonFromTruncated } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import { SCENE_PLAN_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"
import type { SceneCreateInput } from "../../workflow/create-scene"
import type { TriageTypes } from "../scene-triage"

const AGENT_NAME = "scene_3d_plan"

export interface PlanType {
  type: string
  purpose: string
  implementation: "native" | "component" | "model"
  /** 具体建法（尺寸/材质/结构/组件 options），供 codegen 照抄，避免 codegen 在 reasoning 里重新设计 */
  build_detail: string
  components: string[]
  resources: string[]
}

export interface PlanResult {
  scene_description: string
  types: PlanType[]
  camera: Record<string, unknown>
  lights: unknown[]
  scene: Record<string, unknown>
}

export type ScenePlanInput = SceneCreateInput & {
  /** triage 产出的 type 清单（create=新建，modify=重写+新建） */
  types: TriageTypes
  /** 是否 modify（plan 据 types.modify + types.create 选型） */
  isModify: boolean
  /** 当前已有 type 清单（modify 时供 plan 知道哪些可继承，勿重复规划） */
  currentTypes?: string[]
  /** 可用资产清单（workspace assetCatalog.ts 源码，注入 [可用资产清单] 让 plan 选 asset:<id>） */
  assetCatalog?: string
}

export default async function scene_3d_plan(input: ScenePlanInput): Promise<PlanResult> {
  const { sdk, sync, modelKey, rootSession, onSessionCreated, userInput, types, isModify, currentTypes, assetCatalog } = input
  const humanMessage = buildHumanMessage(userInput, types, isModify, currentTypes, assetCatalog)
  console.log("----- 3D 场景规划Agent开始执行 ----- ")
  const startTime = Date.now()
  const planRes = await runChildSession({
    sync,
    modelKey,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: SCENE_PLAN_FORMAT.schema,
    onSessionCreated,
    extra: input.extra,
    fileParts: input.fileParts,
    // P6-2：plan output 才 2.6K-5.3K tokens，reasoning 模型思考期间零增长，
    // 180s idle 太宽——SSE 漏推 message.completed 时多等 180s+30s grace 才 resync。
    // 缩到 60s：stall gap 277/427s→~90s。thinking 期间零增长误判风险靠 partial 抢救兜底。
    idleTimeoutMs: 60_000,
  })
  console.log("----- 3D 场景规划Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  // 先透传 LLM 返回的错误（idle 超时 / APIError / 限流 / 超上下文），
  // 否则拿空 text 跑 extractJson → 报"did not return valid JSON"掩盖真实原因。
  if (planRes.error) {
    // P1.4① 部分输出抢救：墙钟超时/流中断时已收部分常是高质量截断 JSON（实证 696KB/3237
    // chunk 仍在吐字）。语法级截断修复 + 语义完整性验证（types 必须完整覆盖 triage 的
    // create+modify 清单——残缺 types 会物化出丢物体的场景）。完整则继续流水线并留痕，
    // 否则照旧抛错让用户经失败卡片决定重试（不自动重试，对齐 make 用户主权）。
    const recovered = extractJsonFromTruncated(planRes.text)
    if (recovered && isPlanTypesComplete(recovered, types)) {
      console.warn(
        `[scene_3d_plan] LLM 报错（${planRes.error}）但部分输出抢救成功：types 完整覆盖 triage 清单，继续流水线`,
      )
      const planValue = assemblePlan(recovered)
      logAgentParsed(planRes.childSessionId, { ...planValue, recoveredFromError: planRes.error })
      return planValue
    }
    logAgentParsed(planRes.childSessionId, { error: planRes.error })
    agentThrow(AGENT_NAME, planRes.childSessionId, planRes.error)
  }
  const planJson = extractJson(planRes.text)
  if (!planJson) {
    console.error(`[scene_3d_plan] extractJson 失败。text.length=${planRes.text.length}`)
    console.error(`[scene_3d_plan] 输出前 2000 字符:\n`, planRes.text.slice(0, 2000))
    console.error(`[scene_3d_plan] 输出后 2000 字符（看有无截断 / reasoning / 非 JSON）:\n`, planRes.text.slice(-2000))
    logAgentParsed(planRes.childSessionId, { error: "Failed to parse JSON", raw: planRes.text })
    agentThrow(AGENT_NAME, planRes.childSessionId, "Scene Plan did not return valid JSON")
  }
  // 碎片守卫：extractJson 的绝地求生可能返回「碰巧合法」的内层碎片（loose 拼接的 reasoning
  // 散文引号干扰修复器状态机，实证 ses_f9ae615e 拿到 scene.environment 碎片）。碎片缺顶层
  // keys → assemblePlan 静默产空 plan 进 codegen（空 plan 让 LLM 自行发挥，handler 路径漂移
  // 且无 live-data）。复用抢救门槛：types 必须覆盖 triage 清单，否则按解析失败显式报错。
  if (!isPlanTypesComplete(planJson, types)) {
    console.error(
      `[scene_3d_plan] extractJson 返回碎片（顶层 keys=[${Object.keys(planJson).slice(0, 5).join(",")}]，types 未覆盖 triage 清单）`,
    )
    console.error(`[scene_3d_plan] 输出前 2000 字符:\n`, planRes.text.slice(0, 2000))
    logAgentParsed(planRes.childSessionId, { error: "JSON fragment: types incomplete", raw: planRes.text })
    agentThrow(AGENT_NAME, planRes.childSessionId, "Scene Plan 解析得到不完整 JSON（types 未覆盖分诊 type 清单），请重试")
  }
  const returnValue = assemblePlan(planJson)
  logAgentParsed(planRes.childSessionId, returnValue)
  return returnValue
}

/** planJson.types 是否完整覆盖 triage 的 create+modify 清单（抢救的语义完整性门槛）。 */
function isPlanTypesComplete(planJson: Record<string, unknown>, types: TriageTypes): boolean {
  const required = [...types.create, ...types.modify].filter((t) => t && t.trim())
  if (required.length === 0) return true
  const got = new Set(
    Array.isArray(planJson.types)
      ? planJson.types
          .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
          .map((t) => (typeof t.type === "string" ? t.type : ""))
      : [],
  )
  const missing = required.filter((t) => !got.has(t))
  if (missing.length > 0) {
    console.warn(`[scene_3d_plan] 部分输出 types 不完整，缺: ${missing.join(",")} → 放弃抢救`)
    return false
  }
  return true
}

function assemblePlan(planJson: Record<string, unknown>): PlanResult {
  return {
    scene_description: (planJson.scene_description as string) ?? "",
    types: ((planJson.types as PlanType[]) ?? []).map((t) => ({
      type: t.type ?? "",
      purpose: t.purpose ?? "",
      implementation: (t.implementation as PlanType["implementation"]) ?? "native",
      build_detail: (t.build_detail as string) ?? "",
      components: Array.isArray(t.components) ? t.components.filter((c): c is string => typeof c === "string") : [],
      resources: Array.isArray(t.resources) ? t.resources.filter((r): r is string => typeof r === "string") : [],
    })),
    camera: (planJson.camera as Record<string, unknown>) ?? {},
    lights: Array.isArray(planJson.lights) ? planJson.lights : [],
    scene: (planJson.scene as Record<string, unknown>) ?? {},
  }
}

function buildHumanMessage(
  userInput: string,
  types: TriageTypes,
  isModify: boolean,
  currentTypes?: string[],
  assetCatalog?: string,
): string {
  const lines = [
    `[用户请求]: ${userInput}`,
    ``,
    `[分诊 type 清单]:`,
    `- 新建(create): ${JSON.stringify(types.create)}`,
    `- 重写(modify): ${JSON.stringify(types.modify)}`,
    ``,
  ]
  if (isModify && currentTypes && currentTypes.length > 0) {
    lines.push(`[当前场景已有 type（未列入 plan 的将原样继承，勿重复规划）]: ${JSON.stringify(currentTypes)}`, ``)
  }
  if (assetCatalog) {
    lines.push(
      `[可用资产清单]（下方 assetCatalog.ts 源码；model 路线 resources 用 asset:<id>，id 取自清单真实条目，勿臆造）:`,
      "```ts",
      assetCatalog,
      "```",
      ``,
    )
  }
  lines.push(`请输出场景规划 JSON：types 含 create+modify 全部 type 的选型 + camera/lights/scene。`)
  return lines.join("\n")
}
