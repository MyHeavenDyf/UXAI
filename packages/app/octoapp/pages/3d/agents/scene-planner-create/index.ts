import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { ScenePlanner } from "../merge"

const AGENT_NAME = "scene_3d_planner_create"

type ScenePlannerCreateInput = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  // 当前使用的模型
  modelKey: any
  // 根节点session
  rootSession: string
  // 用户输入
  userInput: string
  // 场景意图
  intentDescription: string
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_planner_create(input: ScenePlannerCreateInput) {
  const { sdk, sync, modelKey, userInput, rootSession, intentDescription, onSessionCreated } = input
  const humanMessage = buildHumanMessage(intentDescription)
  console.log("----- 3D 场景规划Agent开始执行 ----- ")
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
  console.log("----- 3D 场景规划Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const plannerJson = extractJson(plannerResult.text)
  if (!plannerJson) {
    logAgentParsed(plannerResult.childSessionId, { error: "Failed to parse JSON", raw: plannerResult.text })
    throw new Error("----- Scene Planner Create did not return valid JSON -----")
  }
  // planner 可能直接返回 layout_planner，也可能返回裸对象（agent prompt 输出 {layout_planner:{...}}）
  const layoutPlanner: ScenePlanner = (plannerJson.layout_planner ?? plannerJson) as ScenePlanner
  const returnValue = {
    layout_planner: layoutPlanner,
    current_step: "planner_create",
  }
  logAgentParsed(plannerResult.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(intentDescription: string): string {
  return `请根据以下场景蓝图，设计 3D 场景的外壳布局（空间分区 group）+ 场景级相机/灯光/背景，并指定每个分区下一步细化物体：
  [Scene Blue_print:] ==================================

  ${intentDescription}
  `
}
