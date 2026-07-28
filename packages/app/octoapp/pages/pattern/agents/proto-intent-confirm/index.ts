import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { INTENT_CONFIRM_FORMAT } from './schema'
import { agentThrow } from '../../utils/error-msg'
import { getPagePatternResource } from '../../utils/pattern-resource'

const AGENT_NAME = "proto_intent_confirm"

export type IntentConfirmDimension = {
  id: string
  name: string
  score: number
  file?: string
  preview?: string
  content?: string
}

export type IntentConfirmResult = {
  results: IntentConfirmDimension[]
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
    schema: INTENT_CONFIRM_FORMAT.schema,
  })
  var json = extractJson(result.text)

  if (!json) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    agentThrow(AGENT_NAME, result.childSessionId, "Intent Confirm did not return valid JSON")
  }
  // 访问云端向量数据库，补充文档和预览图资源 ----- 此处后续要做一个功能：判断是否在内外网
  const enriched = await getPagePatternResource(json)
  const returnValue: IntentConfirmResult = {
    results: (enriched.results ?? []) as IntentConfirmDimension[],
    current_step: "intent_confirm",
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string): string {
  return `[用户的需求:] ==================================
${userInput}

请分析用户需求，匹配合适的Pattern。`
}
