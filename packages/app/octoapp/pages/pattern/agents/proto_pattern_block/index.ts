import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { agentThrow } from '../../utils/error-msg'
import {
  readPatternIndex,
  PAGE_RESOURCE_URL,
} from '../../utils/pattern-resource'
import { PATTERN_BLOCK_FORMAT } from './schema'

const AGENT_NAME = "proto_pattern_block"

// 向量库搜索：根据 query 返回匹配的 block 资源
async function searchResources(
  queries: string | string[],
  topK: number,
  filters: Record<string, number> = { source_id: 4, group_id: 39 },
) {
  const url = `${PAGE_RESOURCE_URL}/api/vector/search`
  const payload = {
    type: "file",
    queries: Array.isArray(queries) ? queries : [queries],
    top_k: topK,
    filters,
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    return { success: false, error: `HTTP error! status: ${response.status}` }
  }
  const data = await response.json()
  return { success: true, data }
}

// 根据 modules[].description 逐个搜索向量库，解析去重后返回真实 block 信息
async function searchByModules(modulesData: { modules?: Array<{ description?: string }> }) {
  const modules = modulesData.modules || []
  const queries = modules.map(m => m.description).filter(Boolean) as string[]
  const allResults: any[] = []
  for (const query of queries) {
    const result = await searchResources(query, 4)
    if (result.success && result.data?.results?.[0]) {
      allResults.push(...result.data.results[0])
    }
  }
  const seenIds = new Set<string>()
  const uniqueResults = allResults.filter((item) => {
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)
    return true
  }).map((item) => ({
    id: item.id,
    description: item.description || "",
    name: item.name || "",
    file: item.file_path || "",
    preview: item.thumbnail_path || "",
    category: item.tags?.length ? item.tags[0] : "",
    structure: item.search_text || "",
  }))
  return { results: uniqueResults }
}

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

  // const patterns = await readPatternIndex("block", theme)
  // if (!patterns || patterns.length === 0) {
  //   return { matches: [], current_step: "pattern_block" }
  // }

  const humanMessage = buildHumanMessage(userInput, pagePattern)
  debugger
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
  const enrichedJson = await searchByModules(matchJson)
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