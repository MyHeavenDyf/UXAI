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

// step-b 的 Node DSL JSON 用 <node-dsl> 标签包裹。按标签边界取内容，避免从混入文字/markdown
// 里靠括号匹配暴力猜 JSON（那样在 JSON 语法错时会误提到一个"合法但不完整"的子片段）。
// 忘写闭合标签（如流式未完或截断）时取到文末；完全没有标签时回退全文（兼容旧会话/未加标签的模型）。
export function extractNodeDsl(text: string): string {
  const m = text.match(/<node-dsl>\s*([\s\S]*?)\s*(?:<\/node-dsl>|$)/i)
  return m ? m[1].trim() : text
}
