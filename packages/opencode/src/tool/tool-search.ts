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
- "select:Name1,Name2" — comma-separated multi-select
- "run tests shell" — keyword search, returns the best matches

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
  return Object.keys(bucket).toSorted().join(", ") || "(none)"
}

export function searchDeferredTools(bucket: Record<string, DeferredTool>, query: string, maxResults: number): string {
  const parsed = parseQuery(query)

  if (parsed.kind === "select") {
    const found = parsed.names.flatMap((name) => {
      const entry = bucket[name]
      return entry ? [entry] : []
    })
    const missing = parsed.names.filter((name) => !bucket[name])
    const parts: string[] = []
    if (found.length) {
      parts.push(`Found ${found.length} deferred tool(s). Call them with execute_tool: {"tool_name": "<name>", "params": {...}}.`)
      parts.push("")
      for (const entry of found) parts.push(formatToolDetails(entry), "")
    }
    if (missing.length) {
      parts.push(`No deferred tool named ${missing.map((name) => `"${name}"`).join(", ")}.`)
      parts.push(`Available deferred tools: ${availableNames(bucket)}`)
    }
    return parts.join("\n").trim()
  }

  if (parsed.terms.length === 0) {
    return `Empty query. Available deferred tools: ${availableNames(bucket)}`
  }

  const matches = rankTools(bucket, parsed.terms, maxResults)
  if (matches.length === 0) {
    return `No deferred tools matched ${parsed.terms.join(" ")}. Available deferred tools: ${availableNames(bucket)}`
  }
  const parts = [
    `Found ${matches.length} deferred tool(s). Call them with execute_tool: {"tool_name": "<name>", "params": {...}}.`,
    "",
  ]
  for (const entry of matches) parts.push(formatToolDetails(entry), "")
  return parts.join("\n").trim()
}
