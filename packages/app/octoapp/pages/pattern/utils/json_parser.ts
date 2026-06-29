import { createRoot, createEffect } from "solid-js"

// 从 AI 返回的字符串中提取 JSON
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null
  try {
    let match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
    let raw = match ? match[1] : text
    let parsed = JSON.parse(raw.trim())
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    let start = text.indexOf("{");
    if (start === -1) return null
    let end = text.lastIndexOf("}");
    if (end <= start) return null
    try {
      let rawjson = text.substring(start, end + 1);
      let parsed = JSON.parse(rawjson.trim())
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
}

/**
 * 监听 sync store 中的消息状态，当指定 session 出现新的已完成 assistant 消息时返回其文本。
 * 替代原先每 2 秒 REST 轮询的方案，零延迟、零额外网络请求。
 *
 * @param sync       前端同步 store（含 data.message / data.part）
 * @param sessionId  目标 session ID
 * @param knownIds   调用 promptAsync 之前已存在的消息 ID 集合，用于区分新消息
 */
export function getResultFromMessages(
  sync: { data: { message: Record<string, Array<Record<string, unknown>>>; part: Record<string, Array<Record<string, unknown>>> } },
  sessionId: string,
  knownIds: Set<string>,
): Promise<string> {
  return new Promise<string>((resolve) => {
    let disposed = false
    createRoot((dispose) => {
      createEffect(() => {
        if (disposed) { dispose(); return }
        const messages = (sync.data.message[sessionId] ?? []) as Array<Record<string, unknown>>
        // 从末尾找最新的、不在 knownIds 中的 assistant 消息
        let target: Record<string, unknown> | undefined
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m.role === "assistant" && !knownIds.has(m.id as string)) {
            target = m
            break
          }
        }
        if (!target) return
        const time = target.time as { created: number; completed?: number } | undefined
        if (!time || typeof time.completed !== "number") return

        // 收集所有文本 parts
        const parts = (sync.data.part[target.id as string] ?? []) as Array<Record<string, unknown>>
        const texts: string[] = []
        for (const p of parts) {
          if (p.type === "text" && p.text) texts.push(p.text as string)
        }
        dispose()
        resolve(texts.join("\n"))
      })
    })
  })
}