/**
 * scene_3d_plan —— 3D codegen 3-agent 之「规划」
 * 调 list_3d_components / get_3d_component_doc 浏览组件库，为 triage 的 type 清单选型
 * （native / component / model + 依赖组件 / 资源）+ 定 camera / lights / scene。
 * 产物（plan JSON）注入 codegen agent 的 [PLAN_JSON]。schema 约束输出结构。
 */
import { extractJson } from "../../utils/json-parser"
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
}

export default async function scene_3d_plan(input: ScenePlanInput): Promise<PlanResult> {
  const { sdk, sync, modelKey, rootSession, onSessionCreated, userInput, types, isModify, currentTypes } = input
  const humanMessage = buildHumanMessage(userInput, types, isModify, currentTypes)
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
  })
  console.log("----- 3D 场景规划Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const planJson = extractJson(planRes.text)
  if (!planJson) {
    logAgentParsed(planRes.childSessionId, { error: "Failed to parse JSON", raw: planRes.text })
    agentThrow(AGENT_NAME, planRes.childSessionId, "Scene Plan did not return valid JSON")
  }
  const returnValue: PlanResult = {
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
  logAgentParsed(planRes.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, types: TriageTypes, isModify: boolean, currentTypes?: string[]): string {
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
  lines.push(`请输出场景规划 JSON：types 含 create+modify 全部 type 的选型 + camera/lights/scene。`)
  return lines.join("\n")
}
