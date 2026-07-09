import { createRoot, createEffect } from "solid-js"

// 从 AI 返回的字符串中提取 JSON
export function extractJson(text: string) {
  // 1. 边界防守
  if (!text || typeof text !== 'string' || !text.trim()) return null;

  // 清洗不可见字符
  let cleanText = text.replace(/[\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ");

  // 2. 移除大模型的思维链
  if (cleanText.includes('</think>')) {
    const thinkEndIndex = cleanText.indexOf('</think>') + '</think>'.length;
    const realJsonStart = cleanText.search(/[\{\[]/);
    if (realJsonStart !== -1 && realJsonStart > thinkEndIndex) {
      cleanText = cleanText.slice(realJsonStart);
    } else {
      cleanText = cleanText.slice(thinkEndIndex);
    }
  }

  try {
    // 3. 优先匹配 Markdown 代码块
    const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\n?```/);
    const raw = match ? match[1] : cleanText;
    return JSON.parse(raw.trim());
  } catch (err) {
    // 4. 绝地求生（无需次数限制的无损全拉满版）
    const lastIdxOfBrace = cleanText.lastIndexOf("}");
    const lastIdxOfBracket = cleanText.lastIndexOf("]");
    
    const endChar = lastIdxOfBracket > lastIdxOfBrace ? "]" : "}";
    const startChar = endChar === "]" ? "[" : "{";

    let end = cleanText.lastIndexOf(endChar);
    if (end === -1) return null;

    let start = cleanText.lastIndexOf(startChar, end);
    
    // 用来记录上一次的指针，防止死循环
    let lastStart = -1; 

    while (start !== -1 && start !== lastStart) {
      lastStart = start;
      try {
        const rawjson = cleanText.substring(start, end + 1);
        const parsed = JSON.parse(rawjson.trim());
        if (parsed && typeof parsed === "object") {
          return parsed; // 🎉 成功抢救！
        }
      } catch {
        // 核心优化：直接找上一个起始符，只要指针在往前走，就允许它一直找，直到文本开头
        start = cleanText.lastIndexOf(startChar, start - 1);
      }
    }

    return null;
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