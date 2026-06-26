import { extractJson } from '../../utils/json_parser'
import { runChildSession } from '../run_child_session'

const AGENT_NAME = "proto_3d_planner"

type Proto3DPlannerInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  // 上游意图蓝图(intent_description)
  intentDescription: any
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 舞台规划 Agent:意图蓝图 → 场景舞台(scene/camera/lights)+ group 骨架 + slot 分配。
 * 后端 system prompt(proto_3d_planner.txt)已含灯光/PBR/group 铁律与输出格式。
 */
export default async function proto_3d_planner(input: Proto3DPlannerInput) {
  const { sdk, sync, modelKey, rootSession, intentDescription, onSessionCreated } = input
  const humanMessage = buildHumanMessage(intentDescription)
  console.log("----- [3D] 舞台规划Agent开始执行 -----")
  const startTime = Date.now()

  const plannerResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })
  console.log("----- [3D] 舞台规划Agent结束,耗时:", (Date.now() - startTime) / 1000, "s -----")

  const plannerJson = extractJson(plannerResult)
  if (!plannerJson) throw new Error("----- [3D] Planner did not return valid JSON -----")
  // 兼容 agent 可能直接返回 scene_planner 或裸对象
  const scene_planner = (plannerJson as any).scene_planner ?? plannerJson
  return {
    scene_planner,
    current_step: "planner_create",
  }
}

function buildHumanMessage(intentDescription: any): string {
  return `请根据以下 3D 场景意图蓝图,搭建场景舞台(渲染环境/相机/灯光)、group 骨架与 slot 分配。

[Scene Intent Blueprint]: ==================================
${JSON.stringify(intentDescription, null, 2)}`
}
