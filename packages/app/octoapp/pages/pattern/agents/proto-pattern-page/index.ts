import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { PATTERN_PAGE_FORMAT } from './schema'
import { agentThrow } from '../../utils/error-msg'
import { getPagePatternResource } from '../../utils/pattern-resource'

const AGENT_NAME = "proto_pattern_page"

export type IntentPageDimension = {
  id: string
  name: string
  score: number
  file?: string
  preview?: string
  content?: string
}

export type IntentPageResult = {
  results: IntentPageDimension[]
  current_step: string
}

type ProtoPatternPageInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_pattern_page(input: ProtoPatternPageInput): Promise<IntentPageResult> {
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
    schema: PATTERN_PAGE_FORMAT.schema,
  })
  var json = extractJson(result.text)

  if (!json) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    agentThrow(AGENT_NAME, result.childSessionId, "Intent Confirm did not return valid JSON")
  }
  // 访问云端向量数据库，补充文档和预览图资源 ----- 此处后续要做一个功能：判断是否在内外网
  const enriched = await getPagePatternResource(json)
  const returnValue: IntentPageResult = {
    results: (enriched.results ?? []) as IntentPageDimension[],
    current_step: "page_matching",
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string): string {
  return `[用户的需求:] ==================================
${userInput}

请分析用户需求，匹配合适的Pattern。`
}
