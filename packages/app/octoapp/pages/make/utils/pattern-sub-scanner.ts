import type { Message } from "@opencode-ai/sdk/v2/client"

export type TextPartLike = { type: string; text?: string }

export interface PatternMatchResult {
  results: Array<{ id: string; name: string; score: number }>
}

export interface ModuleListResult {
  modules: Array<{ type: string; description: string }>
}

// 兼容弱模型：允许标签带属性（如 <pattern-match type="json">）
const PATTERN_MATCH_RE = /<pattern-match[^>]*>\s*([\s\S]*?)\s*<\/pattern-match>/i
const MODULE_LIST_RE = /<module-list[^>]*>\s*([\s\S]*?)\s*<\/module-list>/i
const CONFIRM_CMD_RE = /\[confirm-pattern-page\b[^\]]*\]/

function concatMessageText(parts: TextPartLike[] | undefined): string {
  if (!parts || parts.length === 0) return ""
  return parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text!).join("\n")
}

function tryParseJSON(raw: string): any | null {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  try { return JSON.parse(cleaned) } catch { return null }
}

// 兜底：弱模型可能不加标签、用代码块包裹 JSON、或把 JSON 混在文字里。
// 用花括号配对从文本中提取含指定 key 的 JSON 对象。
function extractJSONWithKey(text: string, key: string): any | null {
  // 1. 代码块中的 JSON
  const codeBlockRe = /```(?:json)?\s*([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = codeBlockRe.exec(text)) !== null) {
    const parsed = tryParseJSON(m[1])
    if (parsed && Array.isArray(parsed[key])) return parsed
  }
  // 2. 整段文本作为 JSON
  const whole = tryParseJSON(text)
  if (whole && Array.isArray(whole[key])) return whole
  // 3. 花括号配对提取嵌入的 JSON 对象
  const needle = `"${key}"`
  let from = 0
  while (true) {
    const ki = text.indexOf(needle, from)
    if (ki === -1) break
    // 向前找最近的未配对 {
    let start = -1
    let depth = 0
    for (let i = ki - 1; i >= 0; i--) {
      if (text[i] === '}') depth++
      else if (text[i] === '{') { if (depth === 0) { start = i; break }; depth-- }
    }
    if (start !== -1) {
      // 向后找配对的 }
      let end = -1
      depth = 0
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      if (end !== -1) {
        const obj = tryParseJSON(text.slice(start, end + 1))
        if (obj && Array.isArray(obj[key])) return obj
      }
    }
    from = ki + needle.length
  }
  return null
}

export function scanPatternMatchFromMessages(
  messages: Message[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
): PatternMatchResult | null {
  if (!messages || messages.length === 0) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue
    const text = concatMessageText(partStore?.[messages[i].id])
    if (!text) continue
    // 1. 严格标签匹配
    const m = text.match(PATTERN_MATCH_RE)
    if (m) {
      const parsed = tryParseJSON(m[1])
      if (parsed && Array.isArray(parsed.results)) return parsed as PatternMatchResult
    }
    // 2. 兜底：无标签时尝试提取 JSON
    const fallback = extractJSONWithKey(text, "results")
    if (fallback) return fallback as PatternMatchResult
  }
  return null
}

export function scanModuleListFromMessages(
  messages: Message[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
): ModuleListResult | null {
  if (!messages || messages.length === 0) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue
    const text = concatMessageText(partStore?.[messages[i].id])
    if (!text) continue
    const m = text.match(MODULE_LIST_RE)
    if (m) {
      const parsed = tryParseJSON(m[1])
      if (parsed && Array.isArray(parsed.modules)) return parsed as ModuleListResult
    }
    const fallback = extractJSONWithKey(text, "modules")
    if (fallback) return fallback as ModuleListResult
  }
  return null
}

// 检查子 session 是否有 assistant 文字输出（区分"弱模型未输出标签"与"API 失败无输出"）
export function hasAssistantOutput(
  messages: Message[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
): boolean {
  if (!messages) return false
  return messages.some((m) => {
    if (m.role !== "assistant") return false
    const text = concatMessageText(partStore?.[m.id])
    return text.trim().length > 0
  })
}

export function isPatternSubConfirmed(
  messages: Message[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
): boolean {
  if (!messages) return false
  let seen = false
  for (const msg of messages) {
    if (msg.role !== "assistant" && msg.role !== "user") continue
    const text = concatMessageText(partStore?.[msg.id])
    if (!text) continue
    if (!seen) { if (MODULE_LIST_RE.test(text)) seen = true; continue }
    if (msg.role === "user" && CONFIRM_CMD_RE.test(text)) return true
  }
  return false
}
