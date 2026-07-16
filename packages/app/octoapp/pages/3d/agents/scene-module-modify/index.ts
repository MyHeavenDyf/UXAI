import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { SceneModuleResult } from "../merge"

const AGENT_NAME = "scene_3d_module_modify"

export interface ModuleModifyInput {
  layoutPlanner: Record<string, unknown>
  idPrefix: string
  sectionId: string
  elementId: string
  originObjects: unknown[]
  modifications: Record<string, unknown>
  intentDescription?: Record<string, unknown>
}

export interface ModuleModifyContext {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  extra?: Record<string, unknown>
  input: ModuleModifyInput
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_module_modify(ctx: ModuleModifyContext): Promise<SceneModuleResult> {
  const { sdk, sync, modelKey, rootSession, onSessionCreated } = ctx
  const humanMessage = buildHumanMessage(ctx.input)
  console.log(`----- 3D 分区物体修改Agent开始执行 [${ctx.input.sectionId}] ----- `)
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
    extra: ctx.extra,
  })
  console.log(`----- 3D 分区物体修改Agent运行结束 [${ctx.input.sectionId}]，耗时：`, (Date.now() - startTime) / 1000, "s -----")
  const modifyJson = extractJson(modifyRes.text)
  if (!modifyJson) {
    logAgentParsed(modifyRes.childSessionId, { error: "Failed to parse JSON", raw: modifyRes.text })
    throw new Error("scene_3d_module_modify did not return valid JSON")
  }
  const returnValue: SceneModuleResult = {
    scene_objects: (modifyJson.scene_objects ?? []) as SceneModuleResult["scene_objects"],
    section_id: ctx.input.sectionId,
    element_id: ctx.input.elementId,
    id_prefix: ctx.input.idPrefix,
  }
  logAgentParsed(modifyRes.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(input: ModuleModifyInput): string {
  const lines = [
    `[顶层布局和Slots]: ===============`,
    JSON.stringify(input.layoutPlanner),
    ``,
    `[分区内部物体id前缀]: ===============`,
    input.idPrefix,
    ``,
    `[当前正在修改分区 section_id]: ===============`,
    input.sectionId,
    ``,
    `[当前正在修改分区 group element_id]: ===============`,
    input.elementId,
    ``,
    `[分区内待修改的 objects 数组] ===============`,
    JSON.stringify(input.originObjects),
    ``,
    `[修改意见] ===============`,
    JSON.stringify(input.modifications),
  ]
  if (input.intentDescription) {
    lines.push(
      ``,
      `[更新后的场景意图] ===============`,
      JSON.stringify(input.intentDescription),
    )
  }
  return lines.join("\n")
}
