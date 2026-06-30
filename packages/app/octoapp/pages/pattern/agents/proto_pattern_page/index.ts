import { extractJson } from '../../utils/json_parser'
import { runChildSession } from '../run_child_session'
import { logAgentParsed } from '../../utils/debug-log'
import {
  readPatternIndex,
  readPatternFile,
  type PatternEntry,
  type PatternMatchItem,
} from '../../utils/pattern-resource'

const AGENT_NAME = "proto_pattern_page"

type ProtoPatternPageInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_pattern_page(input: ProtoPatternPageInput) {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated } = input

  // 1. 通过 IPC 读取页面级 pattern 目录
  const patterns = await readPatternIndex("page")
  if (!patterns || patterns.length === 0) {
    return { matches: [], current_step: "pattern_page" }
  }

  // 2. LLM 匹配
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
  debugger
  // 3. 解析 LLM 返回的匹配结果并加载 pattern 文件内容
  const matchJson = extractJson(result.text)
  if (!matchJson) throw new Error("----- Pattern Page did not return valid JSON -----")
  const returnValue = await resolveMatches(matchJson, patterns)
  logAgentParsed(result.childSessionId, returnValue)
  debugger
  return returnValue
}

function buildHumanMessage(userInput: string, patterns: PatternEntry[]): string {
  return `请判断用户页面描述是否匹配以下某些页面级 Pattern。

[用户页面描述:] ==================================
${userInput}

[可用 Pattern 目录:] ==================================
${JSON.stringify(patterns, null, 2)}`
}

// LLM 返回 [{ name, score }] 数组，按 name 回查目录拿到完整 entry，再读取 path 对应的 pattern 文件
async function resolveMatches(
  matchJson: any,
  patterns: PatternEntry[],
): Promise<{ matches: PatternMatchItem[]; current_step: string }> {
  const items = (Array.isArray(matchJson) ? matchJson : []) as Array<{ name: string; score: number }>
  const matches: PatternMatchItem[] = []
  for (const item of items) {
    const pattern = patterns.find(p => p.name === item.name)
    if (!pattern) {
      // TODO 此处应该扔出一个错误，等待宇成开发
      console.warn(`----- Pattern Page: LLM 返回的 name "${item.name}" 在目录中未找到 -----`)
      continue
    }
    const content = await readPatternFile("page", pattern.path)
    matches.push({ pattern, score: item.score, content })
  }
  return { matches, current_step: "pattern_page" }
}
