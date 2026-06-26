// 从 AI 返回的字符串中提取 JSON —— 领域无关,与 pattern/utils/json_parser.ts 同构
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null
  try {
    let match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
    let raw = match ? match[1] : text
    let parsed = JSON.parse(raw.trim())
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    let start = text.indexOf("{")
    if (start === -1) return null
    let end = text.lastIndexOf("}")
    if (end <= start) return null
    try {
      let rawjson = text.substring(start, end + 1)
      let parsed = JSON.parse(rawjson.trim())
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}

// 从 Session 中每 2 秒轮询,取出最终结果
export async function getResultFromMessages(sdk: any, sessionId: string, aborted: boolean): Promise<string> {
  while (!aborted) {
    await new Promise((r) => setTimeout(r, 2000))
    if (aborted) throw new Error("aborted")
    try {
      const res = await sdk.client.session.messages({ sessionID: sessionId })
      const items = res.data
      if (!items || items.length === 0) continue
      // 找到最新的 assistant 消息
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].info.role !== "assistant") continue
        const item = items[i]
        const msg = item.info
        // 最新 assistant 消息尚未完成,继续等待
        if (msg.time?.completed == null) break
        // 收集所有文本 parts
        const texts: string[] = []
        for (let j = 0; j < item.parts.length; j++) {
          const part = item.parts[j]
          if (part.type === "text" && part.text) texts.push(part.text)
        }
        if (texts.length > 0) return texts.join("\n")
        break
      }
    } catch (error) {
      if (aborted) throw new Error("aborted")
    }
  }
  throw new Error("aborted")
}
