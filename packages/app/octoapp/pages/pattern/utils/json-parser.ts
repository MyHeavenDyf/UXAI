import { createRoot, createEffect } from "solid-js"

// 从 AI 返回的字符串中提取 JSON
export function extractJson(text: string) {
  // ==========================================
  // 1. 边界防守与初步清洗
  // ==========================================
  if (!text || typeof text !== 'string' || !text.trim()) return null;

  let cleanText = text;

  // 如果字符串两头带着外层包裹的双引号（常见于从某些 API 直接读取的 Raw 字符串），先剥离
  if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
    cleanText = cleanText.slice(1, -1);
  }

  // 清洗不可见字符
  cleanText = cleanText.replace(/[\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ");

  // ==========================================
  // 2. 移除大模型的思维链
  // ==========================================
  if (cleanText.includes('</think>')) {
    const thinkEndIndex = cleanText.indexOf('</think>') + '</think>'.length;
    const realJsonStart = cleanText.search(/[\{\[]/);
    if (realJsonStart !== -1 && realJsonStart > thinkEndIndex) {
      cleanText = cleanText.slice(realJsonStart);
    } else {
      cleanText = cleanText.slice(thinkEndIndex);
    }
  }

  // ==========================================
  // 🛠️ 核心补丁：局部破坏性双引号修复器
  // ==========================================
  // 它的原理是匹配 ` : " [内容] " , ` 或 ` : " [内容] " } `
  // 从而精准锁定 Value 内部。然后将内部未转义的双引号替换为中文双引号
  const repairInvalidQuotes = (jsonStr: string) => {
    return jsonStr.replace(/(:\s*")([\s\S]*?)("\s*[,}])/g, (match, p1, p2, p3) => {
      // 将值内部那些由于大模型粗心导致的裸双引号，替换为中文双引号
      const repairedP2 = p2.replace(/"/g, '“'); 
      return p1 + repairedP2 + p3;
    });
  };

  // ==========================================
  // 3. 优先匹配 Markdown 代码块
  // ==========================================
  try {
    const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\n?```/);
    let raw = match ? match[1] : cleanText;
    raw = raw.trim();

    try {
      // 尝试直接正常解析
      return JSON.parse(raw);
    } catch (primaryErr) {
      // 💥 第一次抢救：如果是常规匹配成功但解析报错，极大概率是内部双引号冲突，尝试修复它
      const repairedRaw = repairInvalidQuotes(raw);
      return JSON.parse(repairedRaw);
    }
  } catch (err) {
    // ==========================================
    // 4. 绝地求生（无需次数限制的无损全拉满版）
    // ==========================================
    const lastIdxOfBrace = cleanText.lastIndexOf("}");
    const lastIdxOfBracket = cleanText.lastIndexOf("]");
    
    const endChar = lastIdxOfBracket > lastIdxOfBrace ? "]" : "}";
    const startChar = endChar === "]" ? "[" : "{";

    let end = cleanText.lastIndexOf(endChar);
    if (end === -1) return null;

    let start = cleanText.lastIndexOf(startChar, end);
    let lastStart = -1; // 用来记录上一次的指针，防止死循环

    while (start !== -1 && start !== lastStart) {
      lastStart = start;
      try {
        let rawjson = cleanText.substring(start, end + 1).trim();
        
        try {
          // 盲猜解析
          const parsed = JSON.parse(rawjson);
          if (parsed && typeof parsed === "object") return parsed;
        } catch {
          // 💥 第二次抢救：如果截取片段无法解析，强行洗一遍内部的恶性双引号再试
          const repairedRawJson = repairInvalidQuotes(rawjson);
          const parsed = JSON.parse(repairedRawJson);
          if (parsed && typeof parsed === "object") {
            return parsed; // 🎉 成功强行抢救！
          }
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