import { extractJson } from '../../utils/json_parser'
import { runChildSession } from '../run_child_session'
import { logAgentParsed } from '../../utils/debug-log'

const AGENT_NAME = "proto_intent_confirm"

export type IntentConfirmDimension = {
  type: "single" | "multiple"
  options: string[]
}

export type IntentConfirmResult = {
  // 维度名 → 选项配置；空对象表示无需补充
  options: Record<string, IntentConfirmDimension>
  current_step: string
}

type ProtoIntentConfirmInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_intent_confirm(input: ProtoIntentConfirmInput): Promise<IntentConfirmResult> {
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
  })
  const json = extractJson(result.text)
  if (!json) throw new Error("----- Intent Confirm did not return valid JSON -----")
  const returnValue: IntentConfirmResult = {
    options: json as Record<string, IntentConfirmDimension>,
    current_step: "intent_confirm",
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string): string {
  return `[用户的需求:] ==================================
${userInput}

请分析用户需求中尚未明确的维度，输出缺失维度的选项清单。`
}
