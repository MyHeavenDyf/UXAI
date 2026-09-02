import { createRoot, createEffect } from "solid-js"

// 🛠️ 修复器实现（模块级）：extractJson 与截断抢救 extractJsonFromTruncated 共用。
// 均为「字符串感知」——只动字符串外的 token，字符串内部文字原样保留。

/** 匹配 ` : " [内容] " , ` 锁定 value 内部，把内部未转义裸双引号替换为中文双引号。 */
function repairInvalidQuotesImpl(jsonStr: string) {
  return jsonStr.replace(/(:\s*")([\s\S]*?)("\s*[,}])/g, (match, p1, p2, p3) => {
    const repairedP2 = p2.replace(/"/g, "“")
    return p1 + repairedP2 + p3
  })
}

/** 字符串外 0xXXXX 十六进制字面量转十进制（JSON 不支持十六进制）。 */
function repairHexNumbersImpl(jsonStr: string) {
  let out = ""
  let i = 0
  let inStr = false
  while (i < jsonStr.length) {
    const ch = jsonStr[i]
    if (inStr) {
      out += ch
      if (ch === "\\") {
        out += jsonStr[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === '"') inStr = false
      i++
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      i++
      continue
    }
    // 字符串外检测 0x[0-9a-fA-F]+
    if (ch === "0" && (jsonStr[i + 1] === "x" || jsonStr[i + 1] === "X")) {
      let j = i + 2
      while (j < jsonStr.length && /[0-9a-fA-F]/.test(jsonStr[j])) j++
      if (j > i + 2) {
        out += String(parseInt(jsonStr.slice(i, j), 16))
        i = j
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/** 字符串外裸标识符（变量名/NaN/Infinity/undefined）替换为 null，保留 true/false/null。 */
function repairBareTokensImpl(jsonStr: string) {
  let out = ""
  let i = 0
  let inStr = false
  while (i < jsonStr.length) {
    const ch = jsonStr[i]
    if (inStr) {
      out += ch
      if (ch === "\\") {
        out += jsonStr[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === '"') inStr = false
      i++
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      i++
      continue
    }
    // 字符串外检测标识符 [A-Za-z_$][A-Za-z0-9_$]*
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < jsonStr.length && /[A-Za-z0-9_$]/.test(jsonStr[j])) j++
      const word = jsonStr.slice(i, j)
      out += word === "true" || word === "false" || word === "null" ? word : "null"
      i = j
      continue
    }
    out += ch
    i++
  }
  return out
}

// 从 AI 返回的字符串中提取 JSON
export function extractJson(text: string) {
  // ==========================================
  // 1. 边界防守与初步清洗
  // ==========================================
  if (!text || typeof text !== "string" || !text.trim()) return null

  let cleanText = text

  // 如果字符串两头带着外层包裹的双引号（常见于从某些 API 直接读取的 Raw 字符串），先剥离
  if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
    cleanText = cleanText.slice(1, -1)
  }

  // 清洗不可见字符
  cleanText = cleanText.replace(/[\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ")

  // ==========================================
  // 2. 移除大模型的思维链
  // ==========================================
  if (cleanText.includes("</think>")) {
    const thinkEndIndex = cleanText.indexOf("</think>") + "</think>".length
    const realJsonStart = cleanText.search(/[\{\[]/)
    if (realJsonStart !== -1 && realJsonStart > thinkEndIndex) {
      cleanText = cleanText.slice(realJsonStart)
    } else {
      cleanText = cleanText.slice(thinkEndIndex)
    }
  }

  // ==========================================
  // 🛠️ 核心补丁：局部破坏性双引号修复器
  // ==========================================
  // 它的原理是匹配 ` : " [内容] " , ` 或 ` : " [内容] " } `
  // 从而精准锁定 Value 内部。然后将内部未转义的双引号替换为中文双引号
  const repairInvalidQuotes = (jsonStr: string) => repairInvalidQuotesImpl(jsonStr)

  // ==========================================
  // 🛠️ 核心补丁：十六进制字面量修复器
  // ==========================================
  // LLM 偶把 0xbfd8ff / 0x888888 当作 JSON 数值（如 lights 的 skyColor/groundColor），
  // 但 JSON 不支持十六进制字面量 → JSON.parse 整体失败。扫描「字符串外」的 0x[0-9a-fA-F]+
  // 转十进制；字符串内部的 0x（如 build_detail 里描述用的颜色字面量）原样保留，不破坏语义。
  const repairHexNumbers = (jsonStr: string) => repairHexNumbersImpl(jsonStr)

  // 思维链/前导 reasoning 清理后，统一修复字符串外的十六进制字面量
  cleanText = repairHexNumbers(cleanText)

  // ==========================================
  // 🛠️ 核心补丁：裸标识符修复器
  // ==========================================
  // LLM 偶把变量名/思考残留词当 JSON 值写进数组或对象（如 "lookAt": [0,  inertia, 0]），
  // 或 NaN / Infinity / undefined 这类 JSON 不支持的字面量 → JSON.parse 整体失败。
  // 扫描「字符串外」的标识符 token，除 true/false/null（JSON 合法）外一律替换为 null。
  // 字符串内部的标识符（如 build_detail 描述里的文字）原样保留。
  const repairBareTokens = (jsonStr: string) => repairBareTokensImpl(jsonStr)

  cleanText = repairBareTokens(cleanText)

  // ==========================================
  // 3. 优先匹配 Markdown 代码块
  // ==========================================
  try {
    // 取最后一个 ```json 代码块（final JSON 通常在最后；reasoning 草稿里的 ```json 在前会被跳过）
    const matches = [...cleanText.matchAll(/```(?:json)?\s*([\s\S]*?)\n?```/g)]
    let raw = matches.length > 0 ? matches[matches.length - 1][1] : cleanText
    raw = raw.trim()

    try {
      // 尝试直接正常解析
      return JSON.parse(raw)
    } catch (primaryErr) {
      // 💥 第一次抢救：如果是常规匹配成功但解析报错，极大概率是内部双引号冲突，尝试修复它
      const repairedRaw = repairInvalidQuotes(raw)
      return JSON.parse(repairedRaw)
    }
  } catch (err) {
    // ==========================================
    // 4. 绝地求生（无需次数限制的无损全拉满版）
    // ==========================================
    const lastIdxOfBrace = cleanText.lastIndexOf("}")
    const lastIdxOfBracket = cleanText.lastIndexOf("]")

    const endChar = lastIdxOfBracket > lastIdxOfBrace ? "]" : "}"
    const startChar = endChar === "]" ? "[" : "{"

    let end = cleanText.lastIndexOf(endChar)
    if (end === -1) return null

    let start = cleanText.lastIndexOf(startChar, end)
    let lastStart = -1 // 用来记录上一次的指针，防止死循环

    while (start !== -1 && start !== lastStart) {
      lastStart = start
      try {
        let rawjson = cleanText.substring(start, end + 1).trim()

        try {
          // 盲猜解析
          const parsed = JSON.parse(rawjson)
          if (parsed && typeof parsed === "object") return parsed
        } catch {
          // 💥 第二次抢救：如果截取片段无法解析，强行洗一遍内部的恶性双引号再试
          const repairedRawJson = repairInvalidQuotes(rawjson)
          const parsed = JSON.parse(repairedRawJson)
          if (parsed && typeof parsed === "object") {
            return parsed // 🎉 成功强行抢救！
          }
        }
      } catch {
        // 核心优化：直接找上一个起始符，只要指针在往前走，就允许它一直找，直到文本开头
        start = cleanText.lastIndexOf(startChar, start - 1)
      }
    }

    return null
  }
}

/**
 * 截断 JSON 抢救（P1.4② 部分输出解析）：墙钟超时掐断流式输出时，已收部分常是
 * 高质量但缺闭合括号的 JSON（实证 696KB/3237 chunk）。extractJson 全分支都要求
 * 完整闭合 → 截断必败。此处语法级修复：先走原 extractJson（完整则直用），
 * 失败则逐字符扫描记录「安全截断点」（字符串外的值边界），回退到末尾安全点、
 * 补齐未闭合括号再 parse。只保证语法可解析，语义完整性由调用方验证
 * （如 plan 抢救须验证 types 覆盖 triage 清单，残缺 types 会物化出丢物体的场景）。
 */
export function extractJsonFromTruncated(text: string): Record<string, unknown> | null {
  if (!text || typeof text !== "string") return null
  // 剥前导文字（reasoning/说明），从第一个 { 开始，先过字符串外修复器（hex/裸标识符）
  const start = text.indexOf("{")
  if (start === -1) return null
  let s = repairBareTokensImpl(repairHexNumbersImpl(text.slice(start)))
  const stack: string[] = []
  let inStr = false
  let safeEnd = -1 // 最后一个「字符串外且值边界后」的安全截断点
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (ch === "\\") i++ // 跳过转义对
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]")
    else if (ch === "}" || ch === "]") stack.pop()
    else if (ch === ",") safeEnd = i // 逗号=一个完整 value 刚结束
  }
  // 完整（栈空且字符串闭合）→ 才走 extractJson（含 markdown 块/think 剥离全功能）。
  // 顺序不能反：截断文本里内层对象常是完整的，extractJson 的绝地求生分支会返回
  // 内层片段（丢最外层壳，如只返回 types[0] 而丢 scene_description），语义灾难。
  if (stack.length === 0 && !inStr) {
    const direct = extractJson(text)
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct
    return null
  }

  // 截断在字符串中间（inStr）或值不完整：回退到最后安全点，丢掉不完整尾部
  if (safeEnd > 0) s = s.slice(0, safeEnd)
  // 去掉尾部残留逗号
  s = s.replace(/,\s*$/, "")
  // 补齐未闭合括号（重新扫描补，因为截断后栈状态已变）
  const st2: string[] = []
  let in2 = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (in2) {
      if (ch === "\\") i++
      else if (ch === '"') in2 = false
      continue
    }
    if (ch === '"') in2 = true
    else if (ch === "{" || ch === "[") st2.push(ch === "{" ? "}" : "]")
    else if (ch === "}" || ch === "]") st2.pop()
  }
  // in2=true 说明 safeEnd 落在字符串内部（不可能：safeEnd 是字符串外逗号），防御性放弃
  if (in2) return null
  s += st2.reverse().join("")

  try {
    const parsed = JSON.parse(s)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 同步 store 类型：message 数组 + part 数组（按 messageId 索引）。 */
type SyncStore = {
  data: {
    message: Record<string, Array<Record<string, unknown>>>
    part: Record<string, Array<Record<string, unknown>>>
  }
}

/**
 * 空闲超时默认值：持续该毫秒数无新输出 → 判流式中断（stall）。
 *
 * 用 idle（空闲）而非墙钟（总时长）：glm5.2 正常 codegen 可跑十几分钟但在持续吐 token，
 * 墙钟会误杀；idle 只在「长时间零增长」时才判死——既抓 stall（含 deepseek-flash 中途停顿、
 * 流连接挂起不结束），又不杀慢但正常的生成。3min 给慢模型/网络抖动留足余量。
 */
const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 1000

interface WaitStrategy {
  /** 从全部 messages 里挑出本次要等待的新目标消息（strict=最新一条；loose=全部新消息）。 */
  pickNew(messages: Array<Record<string, unknown>>, knownIds: Set<string>): Array<Record<string, unknown>>
  /** 目标消息是否都已完成（time.completed 是数字）。未完成=还在生成，继续等。 */
  isComplete(targets: Array<Record<string, unknown>>): boolean
  /** 收集目标消息的文本（strict=最新 msg 的 text；loose=全部 msg 的 text+reasoning）。作进度签名 + 最终结果。 */
  collect(targets: Array<Record<string, unknown>>, sync: SyncStore): string
}

/**
 * 中止注册表：waitForResult 创建 Promise 时按 sessionId 注册 reject 入口，供 host 端 halt()
 * 在用户点「停止」时强制解除在途 await——不依赖 provider 是否真停流（某些 provider 的
 * session.abort 不给在途消息写 error/completed，纯反应式 await 会永挂 → 停止按钮毫无反应）。
 * Promise settle（resolve/reject/超时）时 cleanup 自动注销；abortWait 对已注销的 sessionId 是 no-op。
 */
const waitAborts = new Map<string, () => void>()

/** host 端强制中止：解除该 session 在途的 getResultFromMessages(Loose) await，reject("aborted")。 */
export function abortWait(sessionId: string) {
  const fn = waitAborts.get(sessionId)
  if (!fn) return
  waitAborts.delete(sessionId)
  fn()
}

/**
 * 反应式等待 + 空闲超时兜底。核心：模型流式中途停顿（time.completed 永不写、part 不再增长）
 * 时，纯反应式 await 会永久挂起（spinner 永转、checkpoint 永卡 stage=codegen）。idle 定时器
 * 每 5s 巡检，持续 idleMs 无新输出 → reject 超时错误，让上层走 error 分支（失败卡片 + 可重试）。
 */
function waitForResult(
  sync: SyncStore,
  sessionId: string,
  knownIds: Set<string>,
  strategy: WaitStrategy,
  idleMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let disposed = false
    let lastProgressAt = Date.now()
    let lastLen = -1
    let disposeRoot: (() => void) | null = null
    let poll: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      if (disposed) return
      disposed = true
      waitAborts.delete(sessionId)
      if (poll) clearInterval(poll)
      if (disposeRoot) disposeRoot()
    }
    // 注册 host 端强制中止入口：halt() 调 abortWait(sessionId) → 立即 reject("aborted")，
    // 不依赖 provider 是否真停流（某些 provider 的 session.abort 不给在途消息写 error/completed，
    // 纯反应式 await 会永挂 → 停止按钮毫无反应）。Promise settle 时 cleanup 自动注销。
    waitAborts.set(sessionId, () => {
      cleanup()
      reject(new Error("aborted"))
    })
    poll = setInterval(() => {
      if (disposed) return
      if (Date.now() - lastProgressAt > idleMs) {
        cleanup()
        reject(new Error(`模型响应空闲超时（${Math.round(idleMs / 1000)}s 无新输出，疑似流式中断，可重试）`))
      }
    }, 5_000)
    createRoot((dispose) => {
      disposeRoot = dispose
      createEffect(() => {
        if (disposed) {
          dispose()
          return
        }
        const messages = (sync.data.message[sessionId] ?? []) as Array<Record<string, unknown>>
        const targets = strategy.pickNew(messages, knownIds)
        if (targets.length === 0) return
        // 用户取消生成 → 抛中止信号。必须在 isComplete 检查之前：abort 可能只写 m.error
        // （MessageAbortedError）不写 time.completed，先判 isComplete 会在此 return 永不触发 reject
        // → await 永挂、停止按钮毫无反应。
        for (const m of targets) {
          const msgError = m.error as { name?: string } | undefined
          if (msgError?.name === "MessageAbortedError") {
            cleanup()
            reject(new Error("aborted"))
            return
          }
        }
        // 进度续命：收集当前文本，长度变化（part 内容增长）→ 重置空闲计时，防误杀慢但正常的生成
        const text = strategy.collect(targets, sync)
        if (text.length !== lastLen) {
          lastLen = text.length
          lastProgressAt = Date.now()
        }
        if (!strategy.isComplete(targets)) return
        cleanup()
        resolve(text)
      })
    })
  })
}

/** strict 策略：只等最新一条新 assistant 消息的 text（为 JSON 设计：triage/plan 的 final JSON 在最新 msg）。 */
const strictStrategy: WaitStrategy = {
  pickNew(messages, knownIds) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "assistant" && !knownIds.has(m.id as string)) return [m]
    }
    return []
  },
  isComplete(targets) {
    const t = targets[0]?.time as { completed?: number } | undefined
    return typeof t?.completed === "number"
  },
  collect(targets, sync) {
    const parts = (sync.data.part[targets[0]?.id as string] ?? []) as Array<Record<string, unknown>>
    const texts: string[] = []
    for (const p of parts) {
      if (p.type === "text" && p.text) texts.push(p.text as string)
    }
    return texts.join("\n")
  },
}

/** loose 策略：等所有新 assistant 消息的 text + reasoning（codegen 代码块可能分多条 msg / 落在 reasoning part）。 */
const looseStrategy: WaitStrategy = {
  pickNew(messages, knownIds) {
    return messages.filter((m) => m.role === "assistant" && !knownIds.has(m.id as string))
  },
  isComplete(targets) {
    return targets.every((m) => {
      const t = m.time as { completed?: number } | undefined
      return typeof t?.completed === "number"
    })
  },
  collect(targets, sync) {
    const texts: string[] = []
    for (const m of targets) {
      const parts = (sync.data.part[m.id as string] ?? []) as Array<Record<string, unknown>>
      for (const p of parts) {
        if (p.type === "text" && p.text) texts.push(p.text as string)
        if (p.type === "reasoning" && p.text) texts.push(p.text as string)
      }
    }
    return texts.join("\n")
  },
}

/**
 * 监听 sync store 中的消息状态，当指定 session 出现新的已完成 assistant 消息时返回其文本。
 * 替代原先每 2 秒 REST 轮询的方案，零延迟、零额外网络请求。
 *
 * 空闲超时：持续 idleMs 无新输出 → reject（模型 stall 时不再永久挂起）。
 *
 * @param sync       前端同步 store（含 data.message / data.part）
 * @param sessionId  目标 session ID
 * @param knownIds   调用 promptAsync 之前已存在的消息 ID 集合，用于区分新消息
 * @param opts       idleTimeoutMs：空闲超时毫秒（默认 3min）
 */
export function getResultFromMessages(
  sync: SyncStore,
  sessionId: string,
  knownIds: Set<string>,
  opts?: { idleTimeoutMs?: number },
): Promise<string> {
  return waitForResult(sync, sessionId, knownIds, strictStrategy, opts?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS)
}

/**
 * codegen 代码生成专用宽松提取：扫描所有新 assistant 消息（不只最新一条）的所有 part
 * （text + reasoning），拼接返回。3D codegen 输出 `## file:` Markdown 代码块（非 JSON），
 * 代码可能落在 text 或 reasoning part——这里全收集，交 parseCodeFiles 用正则提取。
 * 与 getResultFromMessages（为 JSON 设计：取最新一条 assistant 的 text）的区别：
 * ① 遍历所有新 assistant 消息；② 收集 reasoning part；③ 等所有新消息完成。
 *
 * 空闲超时：持续 idleMs 无新输出 → reject（模型 stall 时不再永久挂起，spinner 不再永转、
 * checkpoint 不再永卡 stage=codegen）。
 *
 * @param opts       idleTimeoutMs：空闲超时毫秒（默认 3min）
 */
export function getResultFromMessagesLoose(
  sync: SyncStore,
  sessionId: string,
  knownIds: Set<string>,
  opts?: { idleTimeoutMs?: number },
): Promise<string> {
  return waitForResult(sync, sessionId, knownIds, looseStrategy, opts?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS)
}
