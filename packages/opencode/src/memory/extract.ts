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
  error?: string
}

// 解析 LLM 输出为结构化操作(JSON 数组),严格校验
export function parseActions(text: string | null | undefined): persist.MemoryAction[] {
  if (!text || typeof text !== "string") return []
  const stripped = text.trim().replace(/^```[a-zA-Z]*\s*/i, "").replace(/```\s*$/i, "").trim()
  const start = stripped.indexOf("[")
  const end = stripped.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const results: persist.MemoryAction[] = []
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue
    const data = item as Record<string, unknown>
    const topic = typeof data.topic === "string" ? data.topic.trim() : ""
    const action = typeof data.action === "string" ? data.action : ""
    if (action === "delete") {
      if (topic) results.push({ action: "delete", topic })
      continue
    }
    if (action === "merge") {
      const from = typeof data.from === "string" ? data.from.trim() : ""
      const into = typeof data.into === "string" ? data.into.trim() : ""
      const content = typeof data.content === "string" ? data.content.trim() : ""
      const summary = typeof data.summary === "string" ? data.summary.trim() : ""
      if (from && into && content) results.push({ action: "merge", from, into, content, summary })
      continue
    }
    if (action !== "create" && action !== "update") continue
    const type = typeof data.type === "string" ? data.type : ""
    const content = typeof data.content === "string" ? data.content.trim() : ""
    const summary = typeof data.summary === "string" ? data.summary.trim() : ""
    if (!["user", "feedback", "project", "reference"].includes(type)) continue
    if (!topic || !content || !summary) continue
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(topic)) continue
    if (content.length > 2000 || summary.length > 200) continue
    results.push({ action: action as "create" | "update", type, topic, content, summary })
  }
  return results.slice(0, 10)
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

  // 游标过滤:只处理上次之后的新消息
  const cursor = persist.readCursor(input.projectID as never)
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

  // 模型:优先配置,否则用 title 模型链
  let mdl
  if (input.memoryModel && input.memoryModel.includes("/")) {
    const [pid, mid] = input.memoryModel.split("/")
    mdl = yield* input.provider.getModel(ProviderID.make(pid), ModelID.make(mid)).pipe(
      Effect.catch(() => input.provider.getTitleModel("test" as never, "test" as never)),
    )
  } else {
    const lastUser = messages.findLast((m) => m.info.role === "user")
    mdl = yield* input.provider.getTitleModel(
      lastUser?.info.role === "user" ? lastUser.info.model.providerID : ("test" as never),
      lastUser?.info.role === "user" ? lastUser.info.model.modelID : ("test" as never),
    )
  }

  // 构建 LLM 输入:会话消息 + 提取指令
  const modelMsgs = yield* MessageV2.toModelMessagesEffect(newMessages, mdl, { stripMedia: true })
  const instructionMessage: ModelMessage = {
    role: "user",
    content: "按系统提示的规则提取上述对话中的记忆。只输出 JSON 数组。",
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
  const actions = parseActions(text)
  if (actions.length === 0) return { parsed: 0, applied: 0 } as ExtractResult

  const version = Date.now()
  const applied = persist.applyActions(input.projectID as never, actions, version)

  // 推进游标到最后一条消息
  const lastMsg = messages[messages.length - 1]
  if (lastMsg) persist.writeCursor(input.projectID as never, lastMsg.info.id as never)

  return { parsed: actions.length, applied } as ExtractResult
})
