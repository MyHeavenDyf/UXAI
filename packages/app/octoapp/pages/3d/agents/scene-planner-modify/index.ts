import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { ScenePlanner, SceneSlot } from "../merge"
import { SCENE_PLANNER_MODIFY_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "scene_3d_planner_modify"

export type PlannerModifyInput = {
  intentReason: string
  intentDelete: string[]
  intentAdd: string[]
  intentModify: Array<{ section_id: string; element_id: string; action: string }>
  intentPage: Record<string, unknown>
  layoutPlanner: Record<string, unknown>
}

export type PlannerModifyContext = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  input: PlannerModifyInput
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_planner_modify(ctx: PlannerModifyContext): Promise<{
  output: ScenePlanner
  removedSectionIds: string[]
}> {
  const { sdk, sync, modelKey, rootSession, onSessionCreated } = ctx
  const humanMessage = buildHumanMessage(ctx.input)
  console.log("----- 3D 场景规划修改Agent开始执行 ----- ")
  const startTime = Date.now()
  const modifyRes = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: SCENE_PLANNER_MODIFY_FORMAT.schema,
  })
  console.log("----- 3D 场景规划修改Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const modifyJson = extractJson(modifyRes.text)
  if (!modifyJson) {
    logAgentParsed(modifyRes.childSessionId, { error: "Failed to parse JSON", raw: modifyRes.text })
    agentThrow(AGENT_NAME, modifyRes.childSessionId, "Scene Planner Modify did not return valid JSON")
  }
  // agent 输出 {output:{rootId,elements,slots,camera,lights,scene}, removedSectionIds} 或裸对象
  const raw = modifyJson.output ?? modifyJson
  const output: ScenePlanner = {
    rootId: (raw.rootId as string) ?? "sceneRoot",
    elements: (raw.elements as ScenePlanner["elements"]) ?? [],
    slots: ((raw.slots as SceneSlot[]) ?? []).map((s) => ({
      section_id: s.section_id ?? "",
      element_id: s.element_id ?? "",
      id_prefix: s.id_prefix ?? "",
      zone_description: s.zone_description,
      object_count_hint: s.object_count_hint,
      operation: (s.operation as "create" | "modify" | "none") ?? "none",
    })),
    camera: raw.camera,
    lights: raw.lights,
    scene: raw.scene,
  }

  const newSectionIds = new Set(output.slots.map((s) => s.section_id))
  const oldSlots = ((ctx.input.layoutPlanner.slots as Array<Record<string, unknown>>) ?? [])
  const removedSectionIds = oldSlots.map((s) => s.section_id as string).filter((id) => !newSectionIds.has(id))
  const returnValue = { output, removedSectionIds }
  logAgentParsed(modifyRes.childSessionId, returnValue)
  return returnValue
}

function cleanSlots(layoutPlanner: Record<string, unknown>): Record<string, unknown> {
  const slots = (layoutPlanner.slots as Array<Record<string, unknown>>) ?? []
  return {
    ...layoutPlanner,
    slots: slots.map((s) => ({ ...s, operation: "none" })),
  }
}

function buildHumanMessage(input: PlannerModifyInput): string {
  const cleanLayout = cleanSlots(input.layoutPlanner)
  return [
    `请根据以下内容，修改 3D 场景外壳布局并指定下一步细化物体：`,
    ``,
    `【Explicit Modification Directives】: ========================`,
    `- 总体需求: ${input.intentReason}`,
    `- 需要删除的分区: ${JSON.stringify(input.intentDelete)}`,
    `- 需要新增的分区: ${JSON.stringify(input.intentAdd)}`,
    `- 需要修改的分区/物体: ${JSON.stringify(input.intentModify)}`,
    ``,
    `【Scene Blueprint】: ========================`,
    JSON.stringify(input.intentPage),
    ``,
    `【Original Macro-Layout JSON & Intent-to-Container Mappings】: ========================`,
    JSON.stringify(cleanLayout),
    ``,
  ].join("\n")
}
