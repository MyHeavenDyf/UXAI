import { Effect } from "effect"
import * as Stream from "effect/Stream"
import type { ModelMessage } from "ai"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import type * as Session from "@/session/session"
import { MemoryDebug } from "./debug"
import type { MemoryType } from "./memory.sql"
import { MemoryStore, type Parsed } from "./store"

const lastExtraction = new Map<string, number>()

export function parseActions(text: string): Parsed[] {
  const stripped = text
    .trim()
    .replace(/^```[a-zA-Z]*\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
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
  return parsed.flatMap((item): Parsed[] => {
    if (!item || typeof item !== "object") return []
    const data = item as Record<string, unknown>
    const topic = typeof data.topic === "string" ? data.topic.trim() : ""
    if (!topic) return []
    if (data.action === "delete") return [{ action: "delete", topic }]
    if (typeof data.type !== "string" || !(MemoryStore.TYPES as readonly string[]).includes(data.type))
      return []
    const content = typeof data.content === "string" ? data.content.trim() : ""
    const summary = typeof data.summary === "string" ? data.summary.trim() : ""
    if (!content || !summary) return []
    return [{ action: "create", type: data.type as MemoryType, topic, content, summary }]
  })
}

// 服务实例由调用方(prompt 层闭包)传入,避免模块级 yield* 把 requirements 泄漏进 runLoop 类型。
export const extract = Effect.fn("MemoryExtract.extract")(function* (input: {
  config: Config.Interface
  agents: Agent.Interface
  provider: Provider.Interface
  llm: LLM.Interface
  session: Session.Info
  history: MessageV2.WithParts[]
  lastUser: MessageV2.User
}) {
  const cfg = (yield* input.config.get()).memory
  if (Flag.OCTO_DISABLE_MEMORY) return
  if (cfg?.enabled === false) return
  // task 工具子会话与被其他会话拉起的嵌套会话不提取,避免记忆污染
  if (input.session.parentID) return
  const interval = (cfg?.extraction_interval_seconds ?? MemoryStore.DEFAULT_EXTRACTION_INTERVAL_SECONDS) * 1000
  const now = Date.now()
  if (now - (lastExtraction.get(input.session.id) ?? 0) < interval) return

  const idx = input.history.findLastIndex(
    (message) =>
      message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
  )
  if (idx === -1) return
  const turn = input.history.slice(idx)
  if (turn.length < 2) return

  lastExtraction.set(input.session.id, now)

  const ag = yield* input.agents.get("memory")
  if (!ag) return

  const fallback = input.provider.getTitleModel(input.lastUser.model.providerID, input.lastUser.model.modelID)
  const [id, mid] = (cfg?.model ?? "").split("/")
  const model =
    cfg?.model && mid
      ? yield* input.provider.getModel(ProviderID.make(id), ModelID.make(mid)).pipe(Effect.catch(() => fallback))
      : yield* fallback

  const msgs = yield* MessageV2.toModelMessagesEffect(turn, model, { stripMedia: true })
  const index = MemoryStore.system(input.session.projectID, cfg?.budget_tokens)[0] ?? "(暂无已有记忆)"
  const messages: ModelMessage[] = [
    ...msgs,
    {
      role: "user",
      content: `分析上面的对话回合，按系统提示的规则提取记忆。\n当前已有记忆索引（避免重复提取；需要修改时输出相同 topic 覆盖，过时时 action 用 delete）：\n${index}\n\n只输出 JSON 数组。`,
    },
  ]

  const text = yield* input.llm
    .stream({
      agent: ag,
      user: input.lastUser,
      sessionID: input.session.id,
      model,
      system: [],
      messages,
      small: true,
      tools: {},
      retries: 1,
    })
    .pipe(
      Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
      Stream.map((e) => e.text),
      Stream.mkString,
    )

  const actions = parseActions(text)
  yield* MemoryDebug.dumpExtract({
    sessionID: input.session.id,
    projectID: input.session.projectID,
    model: `${model.providerID}/${model.id}`,
    prompt: messages,
    indexBefore: index,
    rawOutput: text,
    actions,
  })
  if (actions.length === 0) return
  MemoryStore.write({
    projectID: input.session.projectID,
    sourceSessionID: input.session.id,
    actions,
    budget: cfg?.budget_tokens,
  })
})

export * as MemoryExtract from "./extract"
