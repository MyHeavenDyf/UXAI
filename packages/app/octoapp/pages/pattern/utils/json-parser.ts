import { createRoot, createEffect } from "solid-js"

// 从 AI 返回的字符串中提取 JSON
export function extractJson(text: string) {
  // 1. 边界防守
  if (!text || !text.trim()) return null;

  let cleanText = text;

  // 2. 移除大模型的思维链（如 DeepSeek 的 <think>...</think>）
  if (cleanText.includes('</think>')) {
    const thinkEndIndex = cleanText.indexOf('</think>') + '</think>'.length;
    // 从 </think> 后面开始找第一个真正的 {，避免把 think 内部的括号带进来
    const realJsonStart = cleanText.indexOf('{', thinkEndIndex);
    
    // 如果找到了 {，则裁剪出真正包含 JSON 的后半部分
    if (realJsonStart !== -1) {
      cleanText = cleanText.slice(realJsonStart);
    } else {
      // 如果 think 后面连 { 都没有，可以直接判断格式错误
      return null;
    }
  }

  try {
    // 3. 优先匹配 Markdown 代码块 (操作清洗后的 cleanText)
    let match = cleanText.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/);
    let raw = match ? match[1] : cleanText;
    let parsed = JSON.parse(raw.trim());
    
    console.log(parsed, 'parsed');
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // 4. 绝地求生（截取首尾大括号兜底）
    let start = cleanText.indexOf("{");
    if (start === -1) return null;
    
    let end = cleanText.lastIndexOf("}");
    if (end <= start) return null;
    
    try {
      let rawjson = cleanText.substring(start, end + 1);
      let parsed = JSON.parse(rawjson.trim());
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
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
  return new Promise<string>((resolve, reject) => {
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

        // 用户取消生成时不解析文本，直接抛中止信号
        const msgError = target.error as { name?: string } | undefined
        if (msgError?.name === "MessageAbortedError") {
          disposed = true
          dispose()
          reject(new Error("aborted"))
          return
        }

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