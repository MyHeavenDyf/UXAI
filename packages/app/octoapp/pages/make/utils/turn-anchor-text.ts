/**
 * 锚点 hover 气泡文案提取,与 InsightTurn userText 的取词逻辑对齐:
 * 1. 优先 text part 的 metadata.displayText(@mention chip 的展示文本)
 * 2. 否则首个有内容的 text part,剥离最后 "\n---\n" 之前的上下文注入段
 * 3. 纯附件消息(file part 或 [附件] synthetic 清单,无正文)返回 "[附件]" 占位
 *
 * 返回值用于单行省略气泡,换行与连续空白折叠为单个空格。
 */
export type AnchorPart = {
  type: string
  text?: string
  synthetic?: boolean
  metadata?: Record<string, unknown>
}

const ATTACHMENT_PLACEHOLDER = "[附件]"

function stripContextPrefix(text: string): string {
  const sepIdx = text.lastIndexOf("\n---\n")
  return (sepIdx !== -1 ? text.slice(sepIdx + 5) : text).trim()
}

function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function turnAnchorText(parts: AnchorPart[] | undefined): string {
  const list = parts ?? []
  const textParts = list.filter((p): p is AnchorPart & { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")

  const display = textParts
    .map((p) => p.metadata?.displayText)
    .find((d): d is string => typeof d === "string" && d.trim().length > 0)

  const body = display
    ? display.trim()
    : textParts
        .filter((p) => !p.text.trim().startsWith(ATTACHMENT_PLACEHOLDER))
        .map((p) => stripContextPrefix(p.text))
        .find((t) => t.length > 0)

  if (body) return toSingleLine(body)

  const hasAttachment =
    list.some((p) => p.type === "file") ||
    textParts.some((p) => p.synthetic === true && p.text.startsWith(ATTACHMENT_PLACEHOLDER))
  return hasAttachment ? ATTACHMENT_PLACEHOLDER : ""
}
