import type { Message } from "@opencode-ai/sdk/v2/client"

export type TextPartLike = { type: string; text?: string }

export interface PatternMatchResult {
  results: Array<{ id: string; name: string; score: number }>
}

export interface ModuleListResult {
  modules: Array<{ type: string; description: string }>
}

const PATTERN_MATCH_RE = /<pattern-match>\s*([\s\S]*?)\s*<\/pattern-match>/i
const MODULE_LIST_RE = /<module-list>\s*([\s\S]*?)\s*<\/module-list>/i
const CONFIRM_CMD_RE = /\[confirm-pattern-page\b[^\]]*\]/

function concatMessageText(parts: TextPartLike[] | undefined): string {
  if (!parts || parts.length === 0) return ""
  return parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text!).join("\n")
}

function tryParseJSON(raw: string): any | null {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  try { return JSON.parse(cleaned) } catch { return null }
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
    const m = text.match(PATTERN_MATCH_RE)
    if (!m) continue
    const parsed = tryParseJSON(m[1])
    if (parsed && Array.isArray(parsed.results)) return parsed as PatternMatchResult
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
    if (!m) continue
    const parsed = tryParseJSON(m[1])
    if (parsed && Array.isArray(parsed.modules)) return parsed as ModuleListResult
  }
  return null
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
