import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import { SCENE_INTENT_CONFIRM_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "scene_3d_intent_confirm"

export type IntentConfirmDimension = {
  type: "single" | "multiple"
  options: string[]
}

export type IntentConfirmResult = {
  // 维度名 → 选项配置；空对象表示无需补充
  options: Record<string, IntentConfirmDimension>
  current_step: string
}

type SceneIntentConfirmInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_intent_confirm(input: SceneIntentConfirmInput): Promise<IntentConfirmResult> {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated } = input
  const humanMessage = buildHumanMessage(userInput)

  const result = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: SCENE_INTENT_CONFIRM_FORMAT.schema,
  })
  const json = extractJson(result.text)
  if (!json) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    agentThrow(AGENT_NAME, result.childSessionId, "Scene Intent Confirm did not return valid JSON")
  }
  const returnValue: IntentConfirmResult = {
    options: (json as Record<string, IntentConfirmDimension>) ?? {},
    current_step: "intent_confirm",
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string): string {
  return `[用户的需求:] ==================================
${userInput}

请分析用户 3D 场景需求中尚未明确的维度，输出缺失维度的选项清单。`
}
