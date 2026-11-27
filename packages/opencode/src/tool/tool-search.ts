import type { JSONSchema7 } from "@ai-sdk/provider"
import type { ToolExecutionOptions } from "ai"

export interface DeferredTool {
  name: string
  description: string
  schema: JSONSchema7
  // AI SDK tool execute 签名;由 prompt.ts 的完整包装链(权限询问/追踪/截断)构造,
  // 元工具只做透传委托,不重复包装。
  execute: (args: any, options: ToolExecutionOptions) => Promise<any>
}

export const SEARCH_TOOLS_DESCRIPTION = `Search for deferred tools by name or keyword. Some tools are not loaded directly in your tool list — they appear by name in <available-deferred-tools> messages. Use this tool to discover one of them.

Returns each matched tool's name, description, and parameter schema.

## Query forms
- "select:pixso_get_file" — exact tool name lookup (fastest; use when you know the name from <available-deferred-tools>)
- "select:Name1,Name2" — comma-separated multi-select (at most 16 names per call)
- "run tests shell" — keyword search, returns the best matches (at most 20)

## Limits
Keyword search returns at most 20 tools and select: at most 16; large results are additionally budget-limited by total size. If tools are omitted from the result, fetch them individually with select:Name.

## Two-step workflow (MUST follow exactly)
Deferred tools CANNOT be called directly. You MUST use this two-step pattern:

Step 1 — Search: call this tool to discover the target tool and read its parameter schema.
Step 2 — Execute: call execute_tool with {"tool_name": "<name>", "params": {...}}.

If you don't know the exact tool name, use keyword search first, then read the matched tool's schema before calling execute_tool.

## Failure policy
If execute_tool fails, do NOT re-search for the same tool — it will loop. Stop and tell the user what failed.`

export const EXECUTE_TOOL_DESCRIPTION = `Execute a deferred tool by name with parameters. Use it after discovering a tool via search_tools. This is NOT a remote or external tool — it runs locally with the same permissions as a direct tool call.

## Inputs
- tool_name: exact name of the deferred tool (from <available-deferred-tools> or a search_tools result)
- params: object with the target tool's parameters, matching the schema returned by search_tools

## When to use
ONLY for deferred tools. Tools already in your tool list must be called directly, NOT through execute_tool.

## Failure handling
If this tool returns an error, do NOT retry or re-search. Tell the user what failed and suggest alternatives.`

export function formatAnnouncement(names: string[]): string {
  return [
    "<available-deferred-tools>",
    "The following tools are connected but NOT loaded in your tool list. To use one, first call search_tools to read its schema, then execute_tool to run it:",
    ...names.toSorted().map((name) => `- ${name}`),
    "</available-deferred-tools>",
  ].join("\n")
}

// 元工具自身占用的名字:MCP 工具 key(provider 前缀拼接)若撞上,prompt.ts 会整体
// 降级为直传(不 defer、不建元工具),避免直传工具与元工具同名产生歧义。
export const RESERVED_METATOOL_NAMES = new Set(["search_tools", "execute_tool"])

// 单次 search 结果的总字符预算(约 6K token)。search 结果持久留在 message history
// 且每轮重放,不设上限时大 MCP 工具集下一次查询可注入几十 KB——恰好制造渐进式披露
// 要消除的固定成本。预算按整条目累加,超限停止并附省略名单;不沿用 Truncate.Service
// 的行/字节中段截断,那会把 JSON schema 砍坏。
export const OUTPUT_BUDGET_CHARS = 24_000
export const MAX_SELECT_NAMES = 16
export const MAX_KEYWORD_RESULTS = 20
const MAX_OMITTED_NAMES = 30
const MAX_LISTED_NAMES = 50

export function clampMaxResults(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.min(Math.max(Math.trunc(n), 1), MAX_KEYWORD_RESULTS)
}

export function formatNameList(names: string[]): string {
  const sorted = [...names].toSorted()
  if (sorted.length <= MAX_LISTED_NAMES) return sorted.join(", ") || "(none)"
  return `${sorted.slice(0, MAX_LISTED_NAMES).join(", ")} (+${sorted.length - MAX_LISTED_NAMES} more, see <available-deferred-tools> in system)`
}

type ParsedQuery = { kind: "select"; names: string[] } | { kind: "keywords"; terms: string[] }

export function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim()
  if (!trimmed) return { kind: "keywords", terms: [] }
  if (trimmed.startsWith("select:")) {
    const names = trimmed
      .slice("select:".length)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
    return { kind: "select", names }
  }
  if (trimmed.startsWith("discover:")) {
    return { kind: "keywords", terms: tokenize(trimmed.slice("discover:".length)) }
  }
  return { kind: "keywords", terms: tokenize(trimmed) }
}

function tokenize(text: string): string[] {
  // 与 scoreTool 的 nameWords 同一分隔规则:下划线视作分隔符,查询 "pixso_get"
  // 与工具名 "pixso_get_file" 都拆成 [pixso, get] / [pixso, get, file] 参与词元匹配。
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function scoreTool(name: string, description: string, terms: string[]): number {
  const nameLower = name.toLowerCase()
  const nameWords = nameLower.split(/[^a-z0-9]+/).filter(Boolean)
  const descLower = description.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (nameLower === term) score += 6
    else if (nameWords.includes(term)) score += 4
    else if (nameLower.includes(term)) score += 3
    else if (descLower.includes(term)) score += 1
  }
  return score
}

export function rankTools(bucket: Record<string, DeferredTool>, terms: string[], limit: number): DeferredTool[] {
  const scored = Object.values(bucket)
    .map((entry) => ({ entry, score: scoreTool(entry.name, entry.description, terms) }))
    .filter((item) => item.score > 0)
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
  return scored.slice(0, limit).map((item) => item.entry)
}

function formatToolDetails(entry: DeferredTool): string {
  return [
    `### ${entry.name}`,
    entry.description,
    "Parameters (JSON Schema):",
    JSON.stringify(entry.schema, null, 2),
  ].join("\n")
}

function availableNames(bucket: Record<string, DeferredTool>): string {
  return formatNameList(Object.keys(bucket))
}

// 按整条目累加到总预算为止;首条目即使单独超预算也完整保留(模型必须拿到完整
// schema 才能调用,中段截断会砍坏 JSON)。剩余名字进省略名单引导 select: 单取。
function assembleWithBudget(entries: DeferredTool[]): { body: string; omitted: DeferredTool[] } {
  const shown: string[] = []
  const omitted: DeferredTool[] = []
  let used = 0
  for (const entry of entries) {
    const details = formatToolDetails(entry)
    if (shown.length === 0 || used + details.length <= OUTPUT_BUDGET_CHARS) {
      shown.push(details, "")
      used += details.length
    } else {
      omitted.push(entry)
    }
  }
  return { body: shown.join("\n"), omitted }
}

function formatOmitted(omitted: DeferredTool[]): string {
  const names = omitted.map((entry) => entry.name)
  const listed = names.slice(0, MAX_OMITTED_NAMES).join(", ")
  const rest = names.length > MAX_OMITTED_NAMES ? `, +${names.length - MAX_OMITTED_NAMES} more` : ""
  return `+${names.length} more tools not shown (${listed}${rest}). Call select:Name to fetch them individually.`
}

export function searchDeferredTools(bucket: Record<string, DeferredTool>, query: string, maxResults: unknown): string {
  const parsed = parseQuery(query)

  if (parsed.kind === "select") {
    if (parsed.names.length === 0) {
      return `Empty select: query. Available deferred tools: ${availableNames(bucket)}`
    }
    const requested = parsed.names
    const selected = requested.slice(0, MAX_SELECT_NAMES)
    const found = selected.flatMap((name) => {
      const entry = bucket[name]
      return entry ? [entry] : []
    })
    const missing = selected.filter((name) => !bucket[name])
    const { body, omitted } = assembleWithBudget(found)
    const parts: string[] = []
    if (found.length) {
      parts.push(`Found ${found.length} deferred tool(s). Call them with execute_tool: {"tool_name": "<name>", "params": {...}}.`)
      parts.push("")
      parts.push(body)
    }
    if (requested.length > MAX_SELECT_NAMES) {
      parts.push(`Only the first ${MAX_SELECT_NAMES} of ${requested.length} requested names were processed; re-request the rest with select:.`)
    }
    if (missing.length) {
      parts.push(`No deferred tool named ${missing.map((name) => `"${name}"`).join(", ")}.`)
      parts.push(`Available deferred tools: ${availableNames(bucket)}`)
    }
    if (omitted.length) parts.push(formatOmitted(omitted))
    return parts.join("\n").trim()
  }

  if (parsed.terms.length === 0) {
    return `Empty query. Available deferred tools: ${availableNames(bucket)}`
  }

  const matches = rankTools(bucket, parsed.terms, clampMaxResults(maxResults))
  if (matches.length === 0) {
    return `No deferred tools matched ${parsed.terms.join(" ")}. Available deferred tools: ${availableNames(bucket)}`
  }
  const { body, omitted } = assembleWithBudget(matches)
  const parts = [
    `Found ${matches.length} deferred tool(s). Call them with execute_tool: {"tool_name": "<name>", "params": {...}}.`,
    "",
    body,
  ]
  if (omitted.length) parts.push(formatOmitted(omitted))
  return parts.join("\n").trim()
}
