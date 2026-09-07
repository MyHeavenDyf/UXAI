import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { agentThrow } from '../../utils/error-msg'
import {
  readPatternIndex,
  type PatternEntry,
  type PatternMatchItem,
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

  const patterns = await readPatternIndex("block", theme)
  if (!patterns || patterns.length === 0) {
    return { matches: [], current_step: "pattern_block" }
  }

  const humanMessage = buildHumanMessage(userInput, patterns)
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
  const returnValue = resolveMatches(matchJson, patterns, theme)
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, patterns: PatternEntry[]): string {
  // 按分类分组
  const categorized: Record<string, Array<{ name: string; description: string; structure: string }>> = {}
  for (const p of patterns) {
    const cat = p.category ?? "其他"
    if (!categorized[cat]) categorized[cat] = []
    categorized[cat].push({
      name: p.name,
      description: p.description ?? "",
      structure: p.structure ?? "",
    })
  }
  return `请根据用户对整个页面的描述，判断页面中可能需要用到哪些模块模板。

[用户页面描述:] ==================================
${userInput}

[可用模块模板目录（按分类）:] ==================================
${JSON.stringify(categorized, null, 2)}`
}

function resolveMatches(
  matchJson: any,
  patterns: PatternEntry[],
  _theme: string,
): { matches: PatternMatchItem[]; current_step: string } {
  const items = (matchJson?.matches ?? []) as Array<{ name: string; score: number }>
  const matches: PatternMatchItem[] = []
  for (const item of items) {
    const pattern = patterns.find(p => p.name === item.name)
    if (!pattern) {
      console.warn(`----- Pattern Block: LLM 返回的 name "${item.name}" 在目录中未找到 -----`)
      continue
    }
    matches.push({ pattern, score: item.score })
  }
  return { matches, current_step: "pattern_block" }
}
