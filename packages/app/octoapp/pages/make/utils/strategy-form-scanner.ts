import type { TextPartLike } from "./design-plan-scanner"

export interface StrategyFormData {
  需求背景: string
  设计目标: string
  设计方法: string
  其他: string
  用户画像: string
  用户旅程: string
  研究报告: string
}

export const EMPTY_STRATEGY_FORM: StrategyFormData = {
  需求背景: "",
  设计目标: "",
  设计方法: "",
  其他: "",
  用户画像: "",
  用户旅程: "",
  研究报告: "",
}

const STRATEGY_FIELD_ARTIFACT_RE = /<artifact\b[^>]*\btype\s*=\s*["']text\/strategy-field["'][^>]*\bfield\s*=\s*["']([^"']+)["'][^>]*>/gi

/**
 * Scan sub-agent messages for `<artifact type="text/strategy-field" field="xxx">` tags
 * and extract the field values into a partial StrategyFormData.
 */
export function scanStrategyFields(
  messages: any[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
): Partial<StrategyFormData> {
  if (!messages || messages.length === 0) return {}

  const result: Partial<StrategyFormData> = {}
  const validFields = new Set(Object.keys(EMPTY_STRATEGY_FORM))

  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const text = concatMessageText(partStore?.[msg.id])
    if (!text) continue

    STRATEGY_FIELD_ARTIFACT_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = STRATEGY_FIELD_ARTIFACT_RE.exec(text)) !== null) {
      const fieldName = match[1]
      if (!validFields.has(fieldName)) continue

      const endTag = "</artifact>"
      const contentStart = match.index + match[0].length
      const endIdx = text.indexOf(endTag, contentStart)
      if (endIdx === -1) continue

      const value = text.slice(contentStart, endIdx).trim()
      if (value) {
        ;(result as any)[fieldName] = value
      }
    }
  }

  return result
}

function concatMessageText(parts: TextPartLike[] | undefined): string {
  if (!parts || parts.length === 0) return ""
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n")
}
