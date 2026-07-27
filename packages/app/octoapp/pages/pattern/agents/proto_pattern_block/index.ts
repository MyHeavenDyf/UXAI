import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { agentThrow } from '../../utils/error-msg'
import {
  readPatternIndex,
  getBlockPatternResource,
} from '../../utils/pattern-resource'
import { PATTERN_BLOCK_FORMAT } from './schema'

const AGENT_NAME = "proto_pattern_block"

type ProtoPatternBlockInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  extra?: Record<string, unknown>
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_pattern_block(input: ProtoPatternBlockInput) {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated } = input
  const theme = (input.extra?.designSystem as string) || "ICT3.1"
  const pagePattern = (input.extra?.pagePattern as string) ?? ""
  const humanMessage = buildHumanMessage(userInput, pagePattern)
  const result = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: PATTERN_BLOCK_FORMAT.schema,
  })

  const matchJson = extractJson(result.text)
  if (!matchJson) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    agentThrow(AGENT_NAME, result.childSessionId, "Pattern Block did not return valid JSON")
  }
  // 拿到 modules[].description 后，去请求向量库获取每个 block 的真实信息（name/category/file/preview/structure）
  const enrichedJson = await getBlockPatternResource(matchJson)
  const returnValue = {
    matches: enrichedJson.results,
    current_step: "pattern_block" as const,
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, pagePattern: string): string {
  return `请结合【1.典型页面规范】与【2.用户业务需求描述】，输出一套完整、精准的 UI 模块描述列表（Module List）。

【1.典型页面规范】（保底硬性基线 Mandatory Baseline）==================================
${pagePattern}

【2.用户业务需求描述】（业务上下文与增量场景）==================================
${userInput}`
}