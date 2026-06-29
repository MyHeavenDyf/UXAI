import { extractJson } from '../../utils/json_parser'
import { runChildSession } from '../run_child_session'

const AGENT_NAME = "proto_3d_intent"

type Proto3DIntentInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 意图拓展 Agent:自然语言 → 3D 场景意图蓝图。
 * 后端 system prompt(proto_3d_intent.txt)已含 3D 概念目录与输出格式约束,
 * 前端只需传用户需求。
 */
export default async function proto_3d_intent(input: Proto3DIntentInput) {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated } = input
  const humanMessage = buildHumanMessage(userInput)
  console.log("----- [3D] 意图拓展Agent开始执行 -----")
  const startTime = Date.now()

  const intentResult = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
  })
  console.log("----- [3D] 意图拓展Agent结束,耗时:", (Date.now() - startTime) / 1000, "s -----")

  const intentJson = extractJson(intentResult)
  if (!intentJson) throw new Error("----- [3D] Intent did not return valid JSON -----")
  return {
    intent_description: intentJson,
    intent_page: simplifyIntent(intentJson),
    current_step: "intent_expansion",
  }
}

function buildHumanMessage(userInput: string): string {
  const prefix = "[用户的 3D 场景需求]: "
  const suffix = "\n\n请开始 3D 场景意图拓展,严格按输出格式返回纯 JSON 蓝图。"
  // 已有包装时跳过,避免双层嵌套(多轮对话或回传时)
  if (userInput.startsWith(prefix)) return userInput
  return `${prefix}${userInput}${suffix}`
}

/** 精简版意图(供 UI 展示与下游快速读取) */
function simplifyIntent(data: any) {
  const d = data ?? {}
  return {
    userInput: d.userInput ?? "",
    sceneAnalysis: d.sceneAnalysis ?? "",
    styleSuggestion: d.styleSuggestion ?? "studio",
    scaleSuggestion: d.scaleSuggestion ?? "medium",
    scale: typeof d.scale === "number" ? d.scale : 1,
    lightingPlan: d.lightingPlan ?? "",
    cameraPlan: d.cameraPlan ?? "",
    sections: d.sections ?? [],
  }
}
