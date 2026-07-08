import { createRoot, createEffect } from "solid-js"

// 从 AI 返回的字符串中提取 JSON
export function extractJson(text: string) {
  // 1. 边界防守
  if (!text || !text.trim()) return null;

  let cleanText = text;

  // 2. 移除大模型的思维链（如 DeepSeek 的 <think>...</think>）
  if (cleanText.includes('</think>')) {
    const thinkEndIndex = cleanText.indexOf('</think>') + '</think>'.length;
    const realJsonStart = cleanText.search(/[\{\[]/); // 寻找思维链后的第一个 { 或 [
    
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
    const parsed = JSON.parse(raw.trim());
    
    console.log(parsed, 'parsed');
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // 4. 绝地求生（终极抗压版：同时兼容对象 {} 和数组 []，并带有安全防护）
    const cleanTrimmed = cleanText.trim();
    
    // 动态探测结尾：判断文本中最后出现的到底是 ']' 还是 '}'
    const lastIdxOfBrace = cleanText.lastIndexOf("}");
    const lastIdxOfBracket = cleanText.lastIndexOf("]");
    
    const endChar = lastIdxOfBracket > lastIdxOfBrace ? "]" : "}";
    const startChar = endChar === "]" ? "[" : "{";

    let end = cleanText.lastIndexOf(endChar);
    if (end === -1) return null;

    let start = cleanText.lastIndexOf(startChar, end);
    
    // 安全防护：限制最大向前探测次数，防止遭遇极端恶意长文本时导致 CPU 爆表
    let attempts = 0;
    const MAX_ATTEMPTS = 50; 

    // 循环向上探测，直到成功解析出最完整的 JSON
    while (start !== -1 && attempts < MAX_ATTEMPTS) {
      attempts++;
      try {
        const rawjson = cleanText.substring(start, end + 1);
        const parsed = JSON.parse(rawjson.trim());
        if (parsed && typeof parsed === "object") {
          console.log(parsed, `parsed from recovery (type: ${endChar === "]" ? 'Array' : 'Object'})`);
          return parsed; // 🎉 完美抢救出最外层的完整数据！
        }
      } catch {
        // 如果失败了，说明找的起始符还在 JSON 内部，继续往左边（外面）找更靠前的起始符
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