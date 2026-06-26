import { extractJson } from '../../utils/json_parser'
import { runChildSession } from '../run_child_session'

const AGENT_NAME = "proto_3d_triage"

export type Triage3DModifyItem = {
  object_id: string
  action: string
}

export type Triage3DAddItem = {
  section_id: string
  parent_id: string
  id_prefix: string
  detail: string
}

export type Triage3DResult = {
  routing: "regenerate" | "modify"
  delete: string[]
  add: Triage3DAddItem[]
  modify: Triage3DModifyItem[]
  updated_intent: Record<string, unknown>
  reason: string
}

type Proto3DTriageInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  // 当前场景的顶层规划(scene/camera/lights/groups)
  lastPlanner: any
  // 当前场景所有物体
  lastObjects: any
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 修改分诊 Agent:对已有场景的修改请求,判断 regenerate vs modify,并给出精确指令清单。
 */
export default async function proto_3d_triage(ctx: Proto3DTriageInput): Promise<Triage3DResult> {
  const { sdk, sync, modelKey, rootSession, userInput, lastPlanner, lastObjects, onSessionCreated } = ctx
  const humanMessage = buildHumanMessage(userInput, lastPlanner, lastObjects)
  console.log("----- [3D] 分诊Agent开始执行 -----")
  const startTime = Date.now()

  const triageRes = await runChildSession({
    sync,
    modelKey,
    isRoot: true,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
  })
  console.log("----- [3D] 分诊Agent结束,耗时:", (Date.now() - startTime) / 1000, "s -----")

  const triageJson = extractJson(triageRes)
  if (!triageJson) throw new Error("----- [3D] Triage did not return valid JSON -----")
  return {
    routing: ((triageJson as any).routing as "regenerate" | "modify") ?? "regenerate",
    delete: ((triageJson as any).delete as string[]) ?? [],
    add: ((triageJson as any).add as Triage3DAddItem[]) ?? [],
    modify: ((triageJson as any).modify as Triage3DModifyItem[]) ?? [],
    updated_intent: ((triageJson as any).updated_intent as Record<string, unknown>) ?? {},
    reason: ((triageJson as any).reason as string) ?? "",
  }
}

function buildHumanMessage(userInput: string, lastPlanner: any, lastObjects: any): string {
  return [
    `[用户修改请求]: ${userInput}`,
    ``,
    `[当前场景的舞台规划(scene/camera/lights/groups)]: ${JSON.stringify(lastPlanner)}`,
    ``,
    `[当前场景的所有物体(objects)]: ${JSON.stringify(lastObjects)}`,
    ``,
    `请进行修改分诊,严格按输出格式返回纯 JSON。`,
  ].join("\n")
}
