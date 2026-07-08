export function stripFollowUpTags(text: string): string {
  return text.replace(/<follow-up[\s\S]*?<\/follow-up>\s*/gi, "")
}

// 部分 LLM 会把一条回复拆成多个 text part（寒暄一个、正文一个），只取第一个会丢正文。
// 合并全部 text part，保证拿到完整内容。
export function joinTextParts(parts: { type: string; text?: string }[]): string {
  return parts
    .filter((p): p is { type: string; text: string } => p.type === "text" && !!p.text?.trim())
    .map((p) => p.text.trim())
    .join("\n\n")
}

// step-a prompt 要求语义布局包裹在 <semantic-layout> 标签内，标签外的开场白/寒暄一律丢弃。
// 容错：模型忘写闭合标签时取到文末；完全没有标签（不听话的模型、旧会话存盘产物）时原样
// 返回全文——内容完整优先于格式统一。
export function extractSemanticLayout(text: string): string {
  const m = text.match(/<semantic-layout>\s*([\s\S]*?)\s*(?:<\/semantic-layout>|$)/i)
  return m ? m[1].trim() : text
}

// 聊天界面展示用：只去掉标签标记本身，内容（含标签外的文字）原样保留。
export function stripSemanticLayoutTags(text: string): string {
  return text.replace(/<\/?semantic-layout>\s*/gi, "")
}
