import { Effect, Layer, Context } from "effect"
import * as Stream from "effect/Stream"
import type { ModelMessage } from "ai"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import * as persist from "./persist"

// 提取结果:LLM 输出的结构化操作 + 程序校验过滤后的可执行操作
export interface ExtractResult {
  parsed: number
  applied: number
  skipped?: number
  error?: string
}

// 解析结果三态:
// - ok:成功解析出 JSON 数组(含合法空数组);skipped = 被丢弃的无效条目数
// - parse-error:没解析出 JSON 数组(LLM 输出格式错误)——游标不推进,下次 idle 重试
export type ParseResult =
  | { status: "ok"; actions: persist.MemoryAction[]; skipped: number }
  | { status: "parse-error" }

export function parseActions(text: string | null | undefined): ParseResult {
  if (!text || typeof text !== "string") return { status: "parse-error" }
  const stripped = text.trim().replace(/^```[a-zA-Z]*\s*/i, "").replace(/```\s*$/i, "").trim()
  const start = stripped.indexOf("[")
  const end = stripped.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) return { status: "parse-error" }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return { status: "parse-error" }
  }
  if (!Array.isArray(parsed)) return { status: "parse-error" }
  const results: persist.MemoryAction[] = []
  let skipped = 0
  for (const item of parsed) {
    const before = results.length + skipped
    if (!item || typeof item !== "object") {
      skipped++
      continue
    }
    const data = item as Record<string, unknown>
    const topic = typeof data.topic === "string" ? data.topic.trim() : ""
    const action = typeof data.action === "string" ? data.action : ""
    if (action === "delete") {
      if (topic) results.push({ action: "delete", topic })
      else skipped++
      continue
    }
    if (action === "merge") {
      const from = typeof data.from === "string" ? data.from.trim() : ""
      const into = typeof data.into === "string" ? data.into.trim() : ""
      const content = typeof data.content === "string" ? data.content.trim() : ""
      const summary = typeof data.summary === "string" ? data.summary.trim() : ""
      if (from && into && content && content.length <= 2000 && summary.length <= 200) {
        if (from === into) skipped++
        else results.push({ action: "merge", from, into, content, summary })
      } else skipped++
      continue
    }
    if (action !== "create" && action !== "update") {
      skipped++
      continue
    }
    const type = typeof data.type === "string" ? data.type : ""
    const content = typeof data.content === "string" ? data.content.trim() : ""
    const summary = typeof data.summary === "string" ? data.summary.trim() : ""
    if (!["user", "feedback", "project", "reference"].includes(type) || !topic || !content || !summary) {
      skipped++
      continue
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(topic) || content.length > 2000 || summary.length > 200) {
      skipped++
      continue
    }
    results.push({ action: action as "create" | "update", type, topic, content, summary })
  }
  // 超出单批上限的操作按丢弃计数,不静默截断
  if (results.length > 10) {
    skipped += results.length - 10
    return { status: "ok", actions: results.slice(0, 10), skipped }
  }
  return { status: "ok", actions: results, skipped }
}

// 从会话提取记忆:读消息 → LLM 结构化输出 → 程序持久化
export const extract = Effect.fn("MemoryExtract.extract")(function* (input: {
  sessionID: string
  projectID: string
  agent: Agent.Interface
  provider: Provider.Interface
  llm: LLM.Interface
  sessions: Session.Interface
  memoryModel?: string
}) {
  // 读取会话消息(从循环外,不影响主流程)
  const messages = yield* input.sessions.messages({ sessionID: input.sessionID as never })
  if (messages.length < 2) return { parsed: 0, applied: 0 } as ExtractResult

  // 游标过滤:只处理上次之后的新消息(按 sessionID 独立记录,同项目多会话互不覆盖)
  const cursor = persist.readCursor(input.projectID as never, input.sessionID)
  let startIndex = 0
  if (cursor) {
    const idx = messages.findIndex((m) => (m.info as { id?: string }).id === cursor)
    if (idx !== -1) startIndex = idx + 1
  }
  const newMessages = messages.slice(startIndex)
  if (newMessages.length === 0) return { parsed: 0, applied: 0 } as ExtractResult

  // 解析提取 agent
  const ag = yield* input.agent.get("memory")
  if (!ag) return { parsed: 0, applied: 0 } as ExtractResult

  // 模型:优先 memory.model 配置,否则用会话正在使用的模型(与 title 同链路)
  let mdl
  if (input.memoryModel && input.memoryModel.includes("/")) {
    const [pid, mid] = input.memoryModel.split("/")
    mdl = yield* input.provider.getModel(ProviderID.make(pid), ModelID.make(mid)).pipe(
      Effect.catch(() => Effect.die(`memory model not found: ${input.memoryModel}`)),
    )
  } else {
    const lastUser = messages.findLast((m) => m.info.role === "user")
    if (!lastUser || lastUser.info.role !== "user") return { parsed: 0, applied: 0 } as ExtractResult
    mdl = yield* input.provider.getTitleModel(lastUser.info.model.providerID, lastUser.info.model.modelID)
  }

  // 程序层隔离:提取上下文只保留消息的 text 部分——工具输出、文件内容、
  // subtask/snapshot/patch/reasoning/compaction 等非用户来源一律不进提取输入。
  // 这是 prompt 规则"只提取用户亲口说的话"的硬保障:工具/文件/MCP 里的
  // 『记住X』类指令在数据层就到不了提取模型,防记忆污染与注入。
  // 保留 user/assistant 双方文本:assistant 回复是理解用户确认/纠正的必要上下文。
  // 对已知格式的密钥做基础脱敏:用户粘贴的凭证到不了提取模型,自然不会被记住。
  const textOnly = newMessages
    .flatMap((m) => {
      const parts = m.parts
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? { ...p, text: persist.redactSecrets(p.text) } : p))
      return parts.length === 0 ? [] : [{ ...m, parts }]
    })
  const lastMsg = messages[messages.length - 1]
  if (textOnly.length === 0) {
    // 本批没有可提取的用户/助手文本(纯工具活动):推进游标避免每次 idle 重复处理
    if (lastMsg) persist.writeCursor(input.projectID as never, input.sessionID, lastMsg.info.id as never)
    return { parsed: 0, applied: 0 } as ExtractResult
  }

  // 构建 LLM 输入:会话消息 + 已有记忆 + 提取指令。
  // 提取模型必须看到已有记忆才能正确去重/update/delete/merge。
  const existing = persist.existingDigest(input.projectID as never)
  const modelMsgs = yield* MessageV2.toModelMessagesEffect(textOnly, mdl, { stripMedia: true })
  const instructionMessage: ModelMessage = {
    role: "user",
    content: [
      existing ? `当前项目已有记忆(据此去重,不要重复创建;变化/过时的用 update/delete/merge 修正):\n${existing}` : "",
      "按系统提示的规则提取上述对话中的记忆。只输出 JSON 数组;无值得记忆的新信息时输出 []。",
    ]
      .filter(Boolean)
      .join("\n\n"),
  }
  const messages2: ModelMessage[] = [...modelMsgs, instructionMessage]

  // LLM 调用(与 title() 同款:无工具、无子会话)
  const text = yield* input.llm
    .stream({
      agent: ag,
      user: { id: input.sessionID as never, role: "user", sessionID: input.sessionID as never, agent: "memory", model: { providerID: mdl.providerID, modelID: mdl.id }, time: { created: Date.now() } } as never,
      sessionID: input.sessionID as never,
      model: mdl,
      system: [],
      messages: messages2,
      small: true,
      tools: {},
      retries: 1,
    })
    .pipe(
      Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
      Stream.map((e) => e.text),
      Stream.mkString,
    )

  // 解析并持久化
  const parsed = parseActions(text)
  // 解析失败:游标保留,下次 idle 自然重试(LLM 输出格式错误是可重试的瞬时状态)
  if (parsed.status === "parse-error") return { parsed: 0, applied: 0, error: "parse" } as ExtractResult

  // 合法空数组(无值得记忆的信息)也是处理完成:推进游标,避免同一批消息反复提取
  if (parsed.actions.length === 0) {
    if (lastMsg) persist.writeCursor(input.projectID as never, input.sessionID, lastMsg.info.id as never)
    return { parsed: 0, applied: 0, skipped: parsed.skipped } as ExtractResult
  }

  // 版本取本批次源消息的最大时间,而非提取时刻:并发的旧对话批次即使后落盘,
  // 版本也天然低于新对话写入的记忆,不会把它们覆盖回去
  const version = newMessages.reduce((max, m) => Math.max(max, m.info.time.created), 0)
  // 持久化异步执行(锁等待不阻塞线程);失败向上抛,游标不推进
  const applied = yield* Effect.promise(() =>
    persist.applyActions(input.projectID as never, parsed.actions, version),
  )

  // 游标指向本次消息快照的最后一条消息(按 sessionID 记录)
  if (lastMsg) persist.writeCursor(input.projectID as never, input.sessionID, lastMsg.info.id as never)

  // 被守卫拒绝/无效丢弃的操作计数上报,worker 记日志,不静默
  const skipped = parsed.skipped + (parsed.actions.length - applied)
  return { parsed: parsed.actions.length, applied, skipped } as ExtractResult
})
