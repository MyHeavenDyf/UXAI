import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import {
  readPatternIndex,
  type PatternEntry,
  type PatternMatchItem,
} from '../../utils/pattern-resource'

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
  })

  const matchJson = extractJson(result.text)
  if (!matchJson) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    throw new Error("----- Pattern Block did not return valid JSON -----")
  }
  const returnValue = await resolveMatches(matchJson, patterns, theme)
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, patterns: PatternEntry[]): string {
  const catalog = patterns.map(p => ({
    name: p.name,
    intent: (p as any).intent,
    function: (p as any).function,
    layout: (p as any).layout,
    elements: p.elements,
  }))
  return `请判断用户模块描述是否匹配以下某些模块级 Pattern。

[用户模块描述:] ==================================
${userInput}

[可用 Pattern 目录:] ==================================
${JSON.stringify(catalog, null, 2)}`
}

async function resolveMatches(
  matchJson: any,
  patterns: PatternEntry[],
  theme: string,
): Promise<{ matches: PatternMatchItem[]; current_step: string }> {
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
