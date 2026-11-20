import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import * as Session from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, Context, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { makeRuntime } from "@/effect/run-service"
import { fn } from "@/util/fn"
import { isRecord } from "@/util/record"
import { EventV2 } from "@/v2/event"
import { SessionEvent } from "@/v2/session-event"
import { CompactionSummary } from "./compaction-summary"
import { NonNegativeInt } from "@/util/schema"

const log = Log.create({ service: "session.compaction" })

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
  Estimated: BusEvent.define(
    "session.compaction.estimated",
    Schema.Struct({
      sessionID: SessionID,
      messageID: MessageID,
      tokens: NonNegativeInt,
      limit: NonNegativeInt,
      providerID: ProviderID,
      modelID: ModelID,
    }),
  ),
}

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 15_000
// 摘要请求体积治理:prompt 需放进摘要模型输入上限并预留输出;降级仍放不下时按
// SHRINK_STEPS 对被 provider 拒绝的体积逐级收缩重试(参考 opencode v2 的做法)。
const SUMMARY_RESERVE_MIN = 16_000
const SUMMARY_RESERVE_SHARE = 0.15
const SUMMARY_SHRINK_STEPS = [0.85, 0.7, 0.5, 0.35]
const SUMMARY_FLOOR_TOKENS = 2_000
// 保尾中单个工具输出的动态 token 配额阈值:随模型可用上限缩放(68k 模型 usable≈57.8k → ≈2.9k
// tokens,128k → ≈5.4k),下限保底。超过阈值的输出压缩后复用既有的 time.compacted 渲染契约
// ("[Old tool result content cleared]")从模型上下文清除 —— 巨型工具输出(如全文注入的
// skill 文档)不再撑爆保尾;内容仍完整保留在存储与摘要请求(serialize)中。
const TAIL_TOOL_CLIP_SHARE = 0.05
const TAIL_TOOL_CLIP_MIN_TOKENS = 350
// 地板投影的估算误差安全余量:偏大误杀会话(不可恢复),偏小仅浪费一次摘要后由 preflight 兜底。
const FLOOR_MARGIN_SHARE = 0.08
const FLOOR_MARGIN_MIN = 1_000
const TRANSCRIPT_CLIP = 2_000
// 文档型 text part(skill 注入,首行 "# Skill: <name>")在降级档的独立裁剪配额
const SKILL_DOC_CLIP = 8_000
// 压缩目标线:压缩后投影(固定成本 system+tools + 摘要 + 保尾)尽量压进 usable 的 65%,
// 给续跑留出余量,避免"压完一步又超"的连环二次压缩。固定成本不可压缩、提前扣除,
// 可动部分按剩余空间分配:保尾最多占剩余的 75%,其余留给摘要;摘要给出生成预算,
// 超预算(×1.25 容差)时走既有重试机制收紧。小上下文模型兜底:剩余空间连最小配额
// (保尾 2k + 摘要 2k)都放不下时按最小配额 best-effort 继续,65% 目标让位于"至少能压",
// 死局仍由地板预检拦截。显式 preserve_recent_tokens 配置不削保尾(用户显式意图优先)。
const COMPACTION_TARGET_SHARE = 0.65
const TARGET_TAIL_SHARE = 0.75
const TARGET_AVAILABLE_MIN = MIN_PRESERVE_RECENT_TOKENS + SUMMARY_FLOOR_TOKENS
const SUMMARY_BUDGET_CAP = 6_000
const SUMMARY_OVER_BUDGET = 1.25
// replay 回填正文预算:回填只是保真手段,不该把超限元凶(巨型 pending 正文)verbatim 搬回
// 压缩后的上下文。按压缩后投影(固定成本+保尾+摘要)之外的余量计算,并与保尾同口径
// (usable×25%)封顶;无 contextTokens 时退化为 usable×25%。超预算正文按比例保留首尾,
// skill 文档(命令注入路径)整篇替换为分段重读引用 —— 压缩后估算必然 < usable,
// preflight 的 reject 分支在 replay 场景不再可达。
const REPLAY_BUDGET_SHARE = 0.25
const REPLAY_BUDGET_MIN = 1_000
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

/** `value` cut to `limit` characters from its start and end. */
const clip = (value: string, limit = TRANSCRIPT_CLIP) => {
  if (value.length <= limit) return value
  const half = limit / 2
  return `${value.slice(0, half)}\n[… ${value.length - limit} characters omitted …]\n${value.slice(-half)}`
}

/** skill 文档注入由 Skill.formatLoaded 生成,首行固定为 "# Skill: <name>"。 */
const skillDocName = (text: string) => {
  if (!text.startsWith("# Skill: ")) return undefined
  return text.split("\n", 1)[0]!.slice("# Skill: ".length).trim()
}

/** skill 文档目录行由 Skill.formatLoaded 生成,用于输出被清除后的"分段重读"提示。 */
const SKILL_DIR_LINE = /^Skill directory \(absolute path\): (.+)$/m

/** replay 正文预算化:skill 文档整篇替换为分段重读引用;普通超预算正文按比例保留首尾。返回 undefined 表示无需裁剪。 */
const clipReplayText = (text: string, budget: number) => {
  const skill = skillDocName(text)
  if (skill) {
    const dir = text.match(SKILL_DIR_LINE)?.[1]
    return `[Skill ${skill} document omitted from replay${dir ? `; directory: ${dir}` : ""}. Re-read sections with the read tool if needed.]`
  }
  const total = Token.estimate(text)
  if (total <= budget) return undefined
  const charLimit = Math.max(400, Math.floor((text.length * budget) / (total * 1.1)))
  return `${clip(text, charLimit)}\n[original message clipped by compaction replay: ~${total} tokens original, ~${budget}-token budget]`
}

const replayTextPart = (part: MessageV2.TextPart, budget: number): MessageV2.TextPart => ({
  ...part,
  text: clipReplayText(part.text, budget) ?? part.text,
  synthetic: true,
  metadata: { ...part.metadata, compaction_replay: true },
})

/** 保尾中单个工具输出的 token 配额阈值:可用上限越大,可完整保留的工具输出越多。 */

// 纯提纯出口的连续失败计数(session 级,进程内):生成失败或无显著改进(>原摘要 90%)
// 各累加一次,达到 2 次后不再燃烧摘要请求;有显著改进(≤90%)即重置 —— 渐进收敛(80k→30k)
// 是进展。仅在提纯无改进的罕见路径写入,超容量时整体重置兜底(计数丢失仅放宽一次
// 提纯机会,3 次尝试契约仍在,无害)。
const refinementFailures = new Map<SessionID, number>()

const bumpRefinementFailures = (sessionID: SessionID) => {
  if (refinementFailures.size >= 1_000) refinementFailures.clear()
  refinementFailures.set(sessionID, (refinementFailures.get(sessionID) ?? 0) + 1)
}
export const toolClipCapTokens = (usableTokens: number) =>
  Math.max(TAIL_TOOL_CLIP_MIN_TOKENS, Math.floor(usableTokens * TAIL_TOOL_CLIP_SHARE))

/**
 * 消息切片的"有效体积"副本:超过配额阈值的已完成工具输出替换为渲染层清除后的占位符,
 * 与 time.compacted 的既有渲染契约一致。select/splitTurn 按此体积做保尾预算判断,
 * 使"轮末单条巨型工具输出"的轮可以正常进入保尾(输出被清除,体积恒小)。
 */
export function clipTailToolOutputs(messages: MessageV2.WithParts[], capTokens: number) {
  return messages.map((msg) => {
    if (msg.info.role !== "assistant") return msg
    let changed = false
    const parts = msg.parts.map((part) => {
      if (part.type !== "tool" || part.state.status !== "completed") return part
      // 已标记(time.compacted)或超阈值的输出:按渲染层清除后的占位符计入,
      // 二次压缩的估算与首次压缩后的实际渲染保持同一口径。
      if (!part.state.time.compacted && Token.estimate(part.state.output) <= capTokens) return part
      changed = true
      return { ...part, state: { ...part.state, output: "[Old tool result content cleared]" } }
    })
    return changed ? { ...msg, parts } : msg
  })
}

type SerializeSeen = { skills: Set<string> }

const serialize = (message: MessageV2.WithParts, level: "full" | "user-only" = "full", seen?: SerializeSeen) => {
  if (message.info.role === "user") {
    const texts: string[] = []
    for (const part of message.parts) {
      if (part.type !== "text" || part.ignored || !part.text) continue
      const skill = skillDocName(part.text)
      if (skill && seen?.skills.has(skill)) {
        texts.push(`[Skill ${skill} was loaded again later in the conversation; duplicate content omitted]`)
        continue
      }
      if (skill) seen?.skills.add(skill)
      texts.push(level === "user-only" ? clip(part.text, skill ? SKILL_DOC_CLIP : TRANSCRIPT_CLIP) : part.text)
    }
    const text = texts.join("\n")
    const files = message.parts.flatMap((part) =>
      part.type === "file" ? [`[Attached ${part.mime}: ${part.filename ?? "file"}]`] : [],
    )
    return [...(text ? [`[User]: ${text}`] : []), ...files].join("\n")
  }
  if (level === "user-only") return ""
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.text ? [`[Assistant]: ${part.text}`] : []
      if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
      if (part.type !== "tool") return []
      const call = `[Assistant tool call]: ${part.tool}(${JSON.stringify(part.state.input)})`
      if (part.state.status === "completed") {
        const attachments = (part.state.attachments ?? []).map(
          (item) => `[Attached ${item.mime}: ${item.filename ?? "file"}]`,
        )
        const output = part.state.time.compacted
          ? "[Old tool result content cleared]"
          : truncate([part.state.output, ...attachments].join("\n"))
        return [call, `[Tool result]: ${output}`]
      }
      if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error}`]
      return [call]
    })
    .join("\n")
}

function summaryText(message: MessageV2.WithParts) {
  const text = message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

export function validateSummary(summary: string | undefined) {
  return CompactionSummary.validate(summary)
}

function completedCompactions(messages: MessageV2.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function buildPrompt(input: { previousSummary?: string; context: string[]; pending?: boolean; summaryBudget?: number }) {
  const conversation = `Here is the conversation so far:\n\n<conversation>\n${input.context.join("\n\n")}\n</conversation>`
  const anchor = input.previousSummary
    ? [
        `Here is the summary of the conversation before the <conversation> above:\n\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`,
        "Update the anchored summary using the conversation in the <conversation> tags above.",
        "Preserve still-true details, remove stale details, and merge in the new facts.",
        // 时间衰减:摘要成本随会话增长边际递减 —— 越久远的内容降密度越狠,预算优先保
        // 近期状态,防止锚定摘要靠 "preserve" 惯性只增不减。
        "Compress by age: details that no recent turn touched must shrink progressively — collapse older completed work to single-line outcomes, keep old decisions only as conclusions, and keep full detail only for the current state and next steps.",
        "Spend the token budget on the most recent state first; never restate settled history verbatim.",
      ].join("\n")
    : "Create a new anchored summary from the conversation history in the <conversation> tags above so another coding agent can continue the work."
  // 待处理请求被折叠进摘要时(空尾/overflow 折叠),提示摘要模型显式保留该请求与其依赖上下文,
  // 并对巨型 skill 文档给出"按需分片重读"的指引,防止摘要后模型重新全量加载造成回环。
  const pending = input.pending
    ? [
        "The conversation ends with an unfinished user request. Record that request word-for-word under Next Steps, and include under Critical Context the key facts it needs to continue.",
        "If a large skill or reference document was loaded, list its name and directory under Relevant Files and note that it should be re-read in sections with the read tool rather than loaded in full again.",
      ]
    : []
  // 摘要体量预算:压缩后投影要落进目标线,摘要作为可动部分之一给出明确生成预算。
  const budget = input.summaryBudget
    ? [`Keep the total summary under ~${input.summaryBudget} tokens. Prefer fewer, denser bullets.`]
    : []
  return [conversation, anchor, ...pending, SUMMARY_TEMPLATE, ...budget].join("\n\n")
}

/** 保尾预算:默认 usable×0.25,夹在 2k–15k;可用 compaction.preserve_recent_tokens 覆盖。 */
export function preserveRecentBudget(input: { cfg: Config.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

/**
 * 压缩目标线预算:固定成本(system+tools)提前扣除,可动部分(保尾+摘要)向 usable×65%
 * 对齐。默认保尾预算按剩余空间收紧(下限 2k),摘要预算在剩余空间内分配、夹在 2k–6k;
 * 剩余空间放不下最小配额(小上下文模型)时 fallback=true,按最小预算 best-effort。
 */
export function targetBudget(input: {
  cfg: Config.Info
  model: Provider.Model
  contextTokens?: { system: number; tools: number; usable: number }
}) {
  const usableTokens = input.contextTokens?.usable ?? usable({ cfg: input.cfg, model: input.model })
  const target = Math.floor(usableTokens * COMPACTION_TARGET_SHARE)
  const fixed = input.contextTokens ? input.contextTokens.system + input.contextTokens.tools : 0
  const available = target - fixed
  const existing = preserveRecentBudget(input)
  const tailBudget =
    input.cfg.compaction?.preserve_recent_tokens !== undefined
      ? existing
      : Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.min(existing, Math.floor(available * TARGET_TAIL_SHARE)))
  const summaryBudget = Math.max(SUMMARY_FLOOR_TOKENS, Math.min(SUMMARY_BUDGET_CAP, available - tailBudget))
  return { target, fixed, available, tailBudget, summaryBudget, fallback: available < TARGET_AVAILABLE_MIN }
}

function turns(messages: MessageV2.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: MessageV2.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: MessageV2.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

/**
 * Serialize `head` into a transcript that fits `budget` tokens (undefined = no preflight).
 * Ladder: full → user-only (skill docs clipped to SKILL_DOC_CLIP, other texts to TRANSCRIPT_CLIP) → drop
 * oldest turns at user-only. The newest turn is never dropped; text is undefined when even it cannot fit.
 * Skill docs are deduplicated by name across the transcript: repeat injections collapse to a reference line.
 */
export function conversationWithin(head: MessageV2.WithParts[], budget: number | undefined) {
  const join = (level: "full" | "user-only", messages: MessageV2.WithParts[]) => {
    const seen: SerializeSeen = { skills: new Set() }
    return messages.map((msg) => serialize(msg, level, seen)).filter(Boolean).join("\n\n")
  }
  if (budget === undefined) return { text: join("full", head), degraded: false }
  const full = join("full", head)
  if (Token.estimate(full) <= budget) return { text: full, degraded: false }
  const users = join("user-only", head)
  if (Token.estimate(users) <= budget) return { text: users, degraded: true }
  const all = turns(head)
  for (let i = 1; i < all.length; i++) {
    const text = join("user-only", head.slice(all[i]!.start))
    if (Token.estimate(text) <= budget) return { text, degraded: true }
  }
  return { text: undefined, degraded: true }
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
    contextTokens?: { system: number; tools: number; usable: number }
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderID; modelID: ModelID }
    auto: boolean
    overflow?: boolean
    message?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Bus.Service
  | Config.Service
  | Session.Service
  | Agent.Service
  | Plugin.Service
  | SessionProcessor.Service
  | Provider.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({ cfg: yield* config.get(), tokens: input.tokens, model: input.model })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: MessageV2.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    /** 保留窗口的有效体积:已标记与超阈值工具输出按清除后占位符计入,与压缩后渲染口径一致。 */
    const estimateEffective = Effect.fnUntraced(function* (input: {
      messages: MessageV2.WithParts[]
      model: Provider.Model
      cfg: Config.Info
    }) {
      const capTokens = toolClipCapTokens(usable({ cfg: input.cfg, model: input.model }))
      return yield* estimate({
        messages: clipTailToolOutputs(input.messages, capTokens),
        model: input.model,
      })
    })

    /**
     * 清除消息窗口内超配额的已完成工具输出(time.compacted 落盘,渲染为占位符),
     * 返回清除明细。skill 类输出附带 name/dir(skill 工具 metadata / 文档目录行),
     * 供"分段重读"提示落盘 —— 防止模型因内容被清而重新全量加载造成回环。
     */
    const clearOversizedToolOutputs = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messages: MessageV2.WithParts[]
      capTokens: number
    }) {
      const cleared: Array<{ tool: string; tokens: number; name?: string; dir?: string }> = []
      for (const msg of input.messages) {
        if (msg.info.role !== "assistant") continue
        for (const part of msg.parts) {
          if (part.type !== "tool" || part.state.status !== "completed") continue
          if (part.state.time.compacted) continue
          const tokens = Token.estimate(part.state.output)
          if (tokens <= input.capTokens) continue
          yield* session.updatePart({
            ...part,
            state: { ...part.state, time: { ...part.state.time, compacted: Date.now() } },
          })
          const stateMetadata = isRecord(part.state.metadata) ? part.state.metadata : {}
          cleared.push({
            tool: part.tool,
            tokens,
            name:
              typeof stateMetadata["name"] === "string"
                ? stateMetadata["name"]
                : typeof part.state.input["name"] === "string"
                  ? part.state.input["name"]
                  : undefined,
            dir:
              typeof stateMetadata["dir"] === "string"
                ? stateMetadata["dir"]
                : (part.state.output.match(SKILL_DIR_LINE)?.[1] ?? undefined),
          })
        }
      }
      return cleared
    })

    /**
     * skill 文档被清除后的"分段重读"提示:占位符本身无信息量,模型会本能地重新全量加载
     * 巨型 skill 文档造成溢出回环。提示携带 name/dir,引导用 read 分段重读。
     */
    const writeSkillRereadNotice = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      cleared: Array<{ tool: string; tokens: number; name?: string; dir?: string }>
    }) {
      const seen = new Set<string>()
      const skills = input.cleared.filter((item) => {
        if (item.tool !== "skill" || !item.name) return false
        if (seen.has(item.name)) return false
        seen.add(item.name)
        return true
      })
      if (!skills.length) return
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        metadata: { compaction_skill_cleared: true },
        text: [
          "The following skill documents were cleared from the context to free space:",
          ...skills.map((item) => `- "${item.name}"${item.dir ? ` (directory: ${item.dir})` : ""}`),
          "Their files remain on disk. Re-read only the sections you need with the read tool instead of reloading the full document.",
        ].join("\n"),
        time: { start: Date.now(), end: Date.now() },
      } satisfies MessageV2.TextPart)
      log.info("compaction skill reread notice", {
        sessionID: input.sessionID,
        skills: skills.map((item) => item.name),
        freed: skills.reduce((total, item) => total + item.tokens, 0),
      })
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: MessageV2.WithParts[]
      cfg: Config.Info
      model: Provider.Model
      tailBudget?: number
    }) {
      const limit = input.cfg.compaction?.tail_turns
      if (limit !== undefined && limit <= 0)
        return { head: input.messages, tail_start_id: undefined, emptyTail: false, tailTokens: 0, noop: "tail-turns-disabled" as const }

      const budget = input.tailBudget ?? preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length)
        return { head: input.messages, tail_start_id: undefined, emptyTail: false, tailTokens: 0, noop: "no-turns" as const }
      const recent = limit === undefined ? all : all.slice(-limit)
      const effective = (messages: MessageV2.WithParts[]) =>
        estimateEffective({ messages, model: input.model, cfg: input.cfg })

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        const size = yield* effective(input.messages.slice(turn.start, turn.end))
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: budget - total,
          estimate: (splitInput) => effective(splitInput.messages),
        })
        if (split) keep = split
        else if (!keep) log.info("tail fallback", { budget, size, total })
        break
      }

      // 空尾兜底:裁剪后仍无法建立保尾锚点(轮末巨型用户正文/媒体、单消息轮)时不再放弃压缩,
      // 全部历史进摘要,锚点指向压缩标记自身 —— filterCompacted 据此丢弃标记之前的全部历史。
      if (!keep)
        return { head: input.messages, tail_start_id: undefined, emptyTail: true, tailTokens: 0, noop: undefined }
      if (keep.start === 0)
        return { head: input.messages, tail_start_id: undefined, emptyTail: false, tailTokens: 0, noop: "fits-budget" as const }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
        emptyTail: false,
        tailTokens: yield* effective(input.messages.slice(keep.start)),
        noop: undefined,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      log.info("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: MessageV2.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      log.info("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        log.info("pruned", { count: toPrune.length })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
      contextTokens?: { system: number; tools: number; usable: number }
    }) {
      const startedAt = Date.now()
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is MessageV2.CompactionPart => part.type === "compaction")

      // overflow 时不再把 pending turn 切出压缩范围:巨型工具输出靠动态配额裁剪进保尾;
      // pending turn 被折叠时由 replay 回填其用户正文。
      let pendingUser: MessageV2.WithParts | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            pendingUser = msg
            break
          }
        }
      }

      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
      const cfg = yield* config.get()
      // 压缩目标线:固定成本提前扣除,保尾/摘要预算向 usable×65% 对齐(小上下文模型兜底见 targetBudget)。
      const target = targetBudget({ cfg, model, contextTokens: input.contextTokens })
      log.info("compaction target", {
        sessionID: input.sessionID,
        target: target.target,
        fixed: target.fixed,
        available: target.available,
        tail_budget: target.tailBudget,
        summary_budget: target.summaryBudget,
        fallback: target.fallback,
      })
      if (target.fallback)
        log.warn("compaction target fallback: fixed costs leave too little headroom, using minimum budgets", {
          sessionID: input.sessionID,
          fixed: target.fixed,
          target: target.target,
          available: target.available,
        })
      const history =
        compactionPart && input.messages.at(-1)?.info.id === input.parentID
          ? input.messages.slice(0, -1)
          : input.messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const compactable = history.filter((_, index) => !hidden.has(index))
      const selected = yield* select({
        messages: compactable,
        cfg,
        model,
        tailBudget: target.tailBudget,
      })
      // pending turn 被保尾保留(输出按配额裁剪)时无需 replay,避免把同一消息复制进上下文;
      // 被折叠(空尾或锚点落在其后)时才回填其用户正文。
      const pendingRetained =
        pendingUser && !selected.emptyTail && selected.tail_start_id
          ? (() => {
              const start = compactable.findIndex((m) => m.info.id === selected.tail_start_id)
              return start >= 0 && compactable.findIndex((m) => m.info.id === pendingUser.info.id) >= start
            })()
          : false
      let replay: { info: MessageV2.User; parts: MessageV2.Part[] } | undefined =
        pendingUser && pendingUser.info.role === "user" && !pendingRetained
          ? { info: pendingUser.info, parts: pendingUser.parts }
          : undefined
      const ctx = yield* InstanceState.context
      const tailBudget = target.tailBudget
      const summaryMessage = (): MessageV2.Assistant => ({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      })
      const failSummary = (message: string) =>
        Effect.gen(function* () {
          const fail = {
            ...summaryMessage(),
            finish: "error",
            error: new MessageV2.ContextOverflowError({ message }).toObject(),
          } satisfies MessageV2.Assistant
          yield* session.updateMessage(fail)
          return "stop" as const
        })

      // 自动续跑合成消息(autocontinue 插件可禁用):正常路径与纯裁剪出口共用。
      // noop 标记用于信号失真放行后的续跑:prompt 侧据此跳过重复压缩触发。
      const writeContinueMessage = Effect.fnUntraced(function* (options?: { noop?: boolean }) {
        const info = yield* provider.getProvider(userMessage.model.providerID)
        if (
          !(yield* plugin.trigger(
            "experimental.compaction.autocontinue",
            {
              sessionID: input.sessionID,
              agent: userMessage.agent,
              model: yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID),
              provider: {
                source: info.source,
                info,
                options: info.options,
              },
              message: userMessage,
              overflow: input.overflow === true,
            },
            { enabled: true },
          )).enabled
        )
          return
        const continueMsg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          agent: userMessage.agent,
          model: userMessage.model,
        })
        const text =
          (input.overflow
            ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
            : "") +
          "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: continueMsg.id,
          sessionID: input.sessionID,
          type: "text",
          // Internal marker for auto-compaction followups so provider plugins
          // can distinguish them from manual post-compaction user prompts.
          // This is not a stable plugin contract and may change or disappear.
          metadata: {
            compaction_continue: true,
            ...(options?.noop ? { compaction_noop: true } : {}),
          },
          synthetic: true,
          text,
          time: {
            start: Date.now(),
            end: Date.now(),
          },
        } satisfies MessageV2.TextPart)
      })

      /**
       * 纯提纯出口:仅重写锚定摘要(无新对话内容可折入),把超预算的前次摘要降密度压回
       * summaryBudget。结构校验 + 一次收紧重试(重试产物不再复查体积,渐进收敛交给下轮
       * 触发);永不硬截断 —— 关键事实(Goal/Next Steps/Critical Context)优先保留,
       * 细节分节合并降密度。草稿消息流式生成后立即删除,内容由调用方原地写回旧摘要消息
       * (不动锚点、不新建消息,避免旧摘要对泄漏回上下文)。返回 undefined 表示生成失败
       * 或结构无效(调用方走诚实拒绝)。
       */
      const refinePreviousSummary = Effect.fnUntraced(function* (previous: string) {
        const promptFor = (fixes: string[]) =>
          [
            ...fixes,
            `Rewrite the anchored summary below denser so another coding agent can continue the work. It is currently ~${Token.estimate(previous)} tokens, over its ~${target.summaryBudget}-token budget.`,
            "Preserve every critical fact: active tasks, key decisions, file paths, errors being fixed, and next steps.",
            // 与锚定更新同款时间衰减:按新旧分级降密度,近期状态保真,久远史实收敛成结论。
            "Compress the detail sections by age: merge related bullets, drop stale or superseded details, and collapse older completed work to single-line outcomes — keep full detail only for active tasks, current state, and next steps.",
            `Keep the total summary under ~${target.summaryBudget} tokens.`,
            SUMMARY_TEMPLATE,
            "<previous-summary>",
            previous,
            "</previous-summary>",
          ].join("\n\n")
        const attempt = Effect.fnUntraced(function* (fixes: string[]) {
          const msg = summaryMessage()
          yield* session.updateMessage(msg)
          const processor = yield* processors.create({
            assistantMessage: msg,
            sessionID: input.sessionID,
            model,
          })
          const result = yield* processor.process({
            user: userMessage,
            agent,
            sessionID: input.sessionID,
            tools: {},
            system: [],
            messages: [{ role: "user", content: [{ type: "text", text: promptFor(fixes) }] }],
            model,
          })
          const stored = (yield* session.messages({ sessionID: input.sessionID })).find(
            (item) => item.info.id === msg.id,
          )
          const summary = stored ? summaryText(stored) : undefined
          yield* session.removeMessage({ sessionID: input.sessionID, messageID: msg.id })
          if (!summary || processor.message.error || result === "stop") return undefined
          const repaired = CompactionSummary.repair(summary)
          const final = repaired.summary
          if (!final || !CompactionSummary.validate(final).valid) return undefined
          return { summary: final, tokens: Token.estimate(final) }
        })
        const first = yield* attempt([])
        if (!first) return undefined
        const validation = CompactionSummary.validate(first.summary)
        if (validation.missingCore.length === 0 && first.tokens <= Math.ceil(target.summaryBudget * SUMMARY_OVER_BUDGET))
          return first
        // 结构修复与体量收紧共用一次重试;重试失败时保留首次产物(渐进收敛,不硬截断)。
        return (
          (yield* attempt([
            ...(validation.missingCore.length > 0
              ? [`Your previous summary was missing required sections: ${validation.missingCore.join(", ")}.`]
              : []),
            `Your previous summary was about ${first.tokens} tokens, over the ~${target.summaryBudget}-token budget. Shorten it to under the budget while keeping every required section.`,
          ])) ?? first
        )
      })

      /**
       * 纯裁剪压缩出口:不打摘要请求,直接清除全部可压缩历史中超配额的已完成工具输出
       * (调用方已打标记),锚点指向历史首条消息(全量保留)。no-op(fits-budget 等)场景
       * 的历史有效体积本就 ≤ 保尾预算,清除后必过续跑 preflight;pending 原件保留在上下文,
       * 不再 replay。
       */
      const finishClipOnly = Effect.fnUntraced(function* (
        cleared: Array<{ tool: string; tokens: number; name?: string; dir?: string }>,
        trigger: string,
      ) {
        const freed = cleared.reduce((total, item) => total + item.tokens, 0)
        const msg = { ...summaryMessage(), finish: "stop" } satisfies MessageV2.Assistant
        yield* session.updateMessage(msg)
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          text: `Cleared ${cleared.length} oversized tool output${cleared.length === 1 ? "" : "s"} (~${freed} tokens) to free context. No summary was needed.`,
          time: { start: Date.now(), end: Date.now() },
        } satisfies MessageV2.TextPart)
        const anchorID = compactable[0]?.info.id
        if (compactionPart && anchorID && compactionPart.tail_start_id !== anchorID) {
          compactionPart.tail_start_id = anchorID
          yield* session.updatePart(compactionPart)
        }
        yield* writeSkillRereadNotice({
          sessionID: input.sessionID,
          agent: userMessage.agent,
          model: userMessage.model,
          cleared,
        })
        if (input.auto) yield* writeContinueMessage()
        log.warn("compaction clip-only continue", {
          sessionID: input.sessionID,
          trigger,
          cleared: cleared.length,
          freed,
          tools: cleared.map((item) => item.tool),
          anchor: anchorID,
        })
        EventV2.run(SessionEvent.Compaction.Ended.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          text: "",
          include: anchorID ?? input.parentID,
        })
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        return "continue" as const
      })

      // 修复「no-op 压缩」:select 判定"有效体积装得下保尾"(fits-budget / no-turns /
      // tail-turns-disabled)时,超限大头必然是尚未落盘的超配额工具输出 —— 估算口径
      // 按占位符计,但标记只在压缩成功路径打,直接拒绝会让巨型输出纹丝不动并终止会话。
      // 清得出且有效体积放得下 → 纯裁剪压缩出口;清不出时按全账核算(固定成本 + 可压缩
      // 历史 + 前次摘要实长 + 余量):摘要主导 → 纯提纯出口,全账放得下 → 信号失真放行
      // (触发口径与可行性口径不一致时不再误杀);其余保留诚实拒绝,话术点名真实主导项。
      if (selected.tail_start_id === undefined && !selected.emptyTail) {
        const historyTokens = yield* estimateEffective({ messages: compactable, model, cfg })
        const cleared = yield* clearOversizedToolOutputs({
          sessionID: input.sessionID,
          messages: compactable,
          capTokens: toolClipCapTokens(usable({ cfg, model })),
        })
        const fixedTokens = input.contextTokens ? input.contextTokens.system + input.contextTokens.tools : 0
        if (
          cleared.length > 0 &&
          (!input.contextTokens ||
            fixedTokens + historyTokens + Math.ceil(historyTokens * FLOOR_MARGIN_SHARE) < input.contextTokens.usable)
        ) {
          replay = undefined
          return yield* finishClipOnly(cleared, `no-op-${selected.noop ?? "fits-budget"}`)
        }
        const summaryTokens = previousSummary ? Token.estimate(previousSummary) : 0
        const fullBase = fixedTokens + historyTokens + summaryTokens
        const fullAccount = fullBase + Math.max(FLOOR_MARGIN_MIN, Math.ceil(fullBase * FLOOR_MARGIN_SHARE))

        // 纯提纯出口:前次摘要超预算且主导全账压力 → 只重写锚定摘要(降密度,不截断),
        // 提纯结果原地写回旧摘要消息的文本 —— 不动锚点、不新建消息(锚点指向保尾首条会
        // 让旧摘要对泄漏回 filterCompacted 的连续保留窗口)。提纯后按新全账决定续跑或
        // 诚实拒绝;连续两次仍压不回预算则不再燃烧摘要请求。
        if (
          selected.noop === "fits-budget" &&
          !input.overflow &&
          previousSummary &&
          summaryTokens > Math.ceil(target.summaryBudget * SUMMARY_OVER_BUDGET) &&
          input.contextTokens &&
          fullAccount >= input.contextTokens.usable &&
          (refinementFailures.get(input.sessionID) ?? 0) < 2
        ) {
          const refined = yield* refinePreviousSummary(previousSummary)
          // 提纯结果改进门禁:仅当有效且小于原摘要时才原地覆盖(不破坏原有可用摘要);
          // 显著改进(≤90%)重置连续失败计数 —— 渐进收敛(80k→30k)是进展,不该被累加。
          const improved = !!refined && refined.tokens < summaryTokens
          if (refined && improved) {
            const pair = prior.at(-1)!
            const oldSummary = history[pair.assistantIndex]!
            const textParts = oldSummary.parts.filter((item): item is MessageV2.TextPart => item.type === "text")
            if (textParts[0]) yield* session.updatePart({ ...textParts[0], text: refined.summary })
            yield* Effect.forEach(
              textParts.slice(1),
              (part) =>
                session.removePart({
                  sessionID: input.sessionID,
                  messageID: oldSummary.info.id,
                  partID: part.id,
                }),
              { discard: true },
            )
            const refinedBase = fixedTokens + historyTokens + refined.tokens
            const refinedAccount =
              refinedBase + Math.max(FLOOR_MARGIN_MIN, Math.ceil(refinedBase * FLOOR_MARGIN_SHARE))
            if (refined.tokens <= Math.ceil(summaryTokens * 0.9)) refinementFailures.delete(input.sessionID)
            else bumpRefinementFailures(input.sessionID)
            log.warn("compaction refinement exit", {
              sessionID: input.sessionID,
              previous_tokens: summaryTokens,
              refined_tokens: refined.tokens,
              history_tokens: historyTokens,
              summary_message: oldSummary.info.id,
              projected: refinedAccount,
            })
            EventV2.run(SessionEvent.Compaction.Ended.Sync, {
              sessionID: input.sessionID,
              timestamp: DateTime.makeUnsafe(Date.now()),
              text: refined.summary,
              include: history[pair.userIndex]!.info.id,
            })
            yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
            if (refinedAccount < input.contextTokens.usable) {
              replay = undefined
              if (input.auto) yield* writeContinueMessage()
              return "continue"
            }
            return yield* failSummary(
              `Nothing to compact: the compactable history (~${historyTokens} tokens) fits entirely within the preserved-recent budget (${tailBudget} tokens). The re-condensed previous summary (~${refined.tokens} tokens, down from ~${summaryTokens}) still keeps the projected context at ~${refinedAccount} tokens, at or above the ${input.contextTokens.usable}-token usable limit. Start a new session or reduce the attached content.`,
            )
          }
          // 生成失败或无改进:累加连续失败计数,保留原摘要走诚实拒绝
          bumpRefinementFailures(input.sessionID)
        }

        // 信号失真放行:全账(含前次摘要)放得下 → 触发信号按估算/cache 口径失真处理,
        // 写中性通知(非 summary 消息,不进锚定链、不触发 filterCompacted 折叠)并继续
        // 会话;续跑消息带 compaction_noop 标记,prompt 侧据此跳过重复压缩触发。
        if (!input.overflow && input.contextTokens && fullAccount < input.contextTokens.usable) {
          const notice = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "assistant",
            parentID: input.parentID,
            sessionID: input.sessionID,
            mode: "compaction",
            agent: "compaction",
            variant: userMessage.model.variant,
            path: {
              cwd: ctx.directory,
              root: ctx.worktree,
            },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            finish: "stop",
          } satisfies MessageV2.Assistant)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: notice.id,
            sessionID: input.sessionID,
            type: "text",
            text: `No compaction was needed: the recalculated context (~${fullAccount} tokens including the previous summary and safety margin) fits the ${input.contextTokens.usable}-token usable limit. The overflow signal was recalculated as noise and the session continues.`,
            time: { start: Date.now(), end: Date.now() },
          } satisfies MessageV2.TextPart)
          log.warn("compaction no-op recalculated as noise, continuing", {
            sessionID: input.sessionID,
            reason: selected.noop,
            full_account: fullAccount,
            usable: input.contextTokens.usable,
            history_tokens: historyTokens,
            summary_tokens: summaryTokens,
          })
          replay = undefined
          if (input.auto) yield* writeContinueMessage({ noop: true })
          return "continue"
        }

        const reason: Record<NonNullable<(typeof selected)["noop"]>, string> = {
          "tail-turns-disabled": "compaction.tail_turns is configured to keep the full history",
          "no-turns": "the conversation has no compactable user turns",
          "fits-budget": `the compactable history (~${historyTokens} tokens) fits entirely within the preserved-recent budget (${tailBudget} tokens)`,
        }
        const dominance = input.contextTokens
          ? summaryTokens >= Math.max(input.contextTokens.system, input.contextTokens.tools)
            ? "; the previous summary dominates the remaining context — start a new session"
            : input.contextTokens.tools >= input.contextTokens.system
              ? "; reduce the toolset or switch to a larger-context model"
              : "; shorten the system prompt or switch to a larger-context model"
          : ""
        const pressure = input.contextTokens
          ? ` The remaining context pressure sits outside the compactable history: system prompt ~${input.contextTokens.system} + tools ~${input.contextTokens.tools}${summaryTokens ? ` + previous summary ~${summaryTokens}` : ""} tokens against a ${input.contextTokens.usable}-token usable limit${dominance}.`
          : ""
        const pending = input.overflow
          ? " The pending user message that triggered the overflow stays in the context; reduce or split it and try again."
          : ""
        log.warn("compaction no-op, skipping summary", {
          sessionID: input.sessionID,
          reason: selected.noop,
          history_tokens: historyTokens,
          tail_budget: tailBudget,
          cleared: cleared.length,
          summary_tokens: summaryTokens,
          full_account: fullAccount,
        })
        return yield* failSummary(`Nothing to compact: ${reason[selected.noop ?? "fits-budget"]}.${pending}${pressure}`)
      }

      // 修复「压缩后仍必然超限」:用压缩后投影判定 —— system + tools + 实际保留尾部的有效体积
      // + 摘要尺寸估计 + 估算误差余量。不再用保尾预算上限代替实际消耗(预算上限远大于实际
      // 保留量时会把可救的会话误判为死局)。摘要尺寸在锚定更新模式下以前次摘要体积为预测器,
      // 按收敛口径(不增)取值:锚定更新带时间衰减指令,预期 ≤ 前次;过度乐观的代价只是
      // 浪费一次摘要后由 preflight 兜底,而按增长口径(×1.2)会误杀可救会话(不可恢复)。
      const summaryFloorEstimate = Math.max(
        SUMMARY_FLOOR_TOKENS,
        previousSummary ? Token.estimate(previousSummary) : 0,
      )
      const tailFloorTokens = selected.emptyTail ? 0 : selected.tailTokens
      const floorBase = input.contextTokens
        ? input.contextTokens.system + input.contextTokens.tools + tailFloorTokens + summaryFloorEstimate
        : 0
      const floorMargin = Math.max(FLOOR_MARGIN_MIN, Math.ceil(floorBase * FLOOR_MARGIN_SHARE))
      if (input.contextTokens && floorBase + floorMargin >= input.contextTokens.usable) {
        const projected = floorBase + floorMargin
        log.warn("compaction floor exceeds usable limit, skipping summary", {
          sessionID: input.sessionID,
          system: input.contextTokens.system,
          tools: input.contextTokens.tools,
          tail_tokens: tailFloorTokens,
          summary_estimate: summaryFloorEstimate,
          margin: floorMargin,
          usable: input.contextTokens.usable,
        })
        return yield* failSummary(
          `Compaction cannot bring the context under the limit: system prompt (~${input.contextTokens.system}) + tools (~${input.contextTokens.tools}) + preserved recent history (~${tailFloorTokens}) + summary (~${summaryFloorEstimate}) + safety margin (~${floorMargin}) ≈ ${projected} tokens, at or above the ${input.contextTokens.usable}-token usable limit. Reduce the toolset or switch to a larger-context model.`,
        )
      }
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const promptFor = (conversation: string) =>
        compacting.prompt
          ? [compacting.prompt, "The following is the conversation history:", conversation]
              .filter(Boolean)
              .join("\n\n")
          : [
              buildPrompt({
                previousSummary,
                context: [conversation],
                pending: selected.emptyTail || !!replay,
                summaryBudget: target.summaryBudget,
              }),
              ...compacting.context,
            ]
              .filter(Boolean)
              .join("\n\n")
      // 摘要请求体积预检:模板+锚定摘要+全文序列化必须放进摘要模型输入上限并预留输出。
      // 放不下时按 full → user-only(文本裁剪) → 丢弃最旧轮次 降级,而不是盲发后被
      // provider 拒绝重试数分钟(压不动的根因之一)。
      const summaryLimit = model.limit.input ?? model.limit.context
      const summaryBudget =
        summaryLimit > 0
          ? summaryLimit - Math.max(SUMMARY_RESERVE_MIN, Math.floor(summaryLimit * SUMMARY_RESERVE_SHARE))
          : undefined
      const fixedEstimate = Token.estimate(promptFor(""))
      const built = conversationWithin(msgs, summaryBudget === undefined ? undefined : summaryBudget - fixedEstimate)

      if (built.text === undefined) {
        const seen: SerializeSeen = { skills: new Set() }
        const minimal = Token.estimate(msgs.map((msg) => serialize(msg, "user-only", seen)).filter(Boolean).join("\n\n"))
        log.error("compaction transcript exceeds summary model limit", {
          sessionID: input.sessionID,
          modelID: model.id,
          providerID: model.providerID,
          limit: summaryLimit,
          budget: summaryBudget,
          minimal_transcript_tokens: minimal,
        })
        return yield* failSummary(
          `Session too large to compact - the minimal transcript (~${minimal} tokens) cannot fit the summary model budget (${summaryBudget} tokens of a ${summaryLimit}-token limit). Reduce the attached content or switch to a larger-context model.`,
        )
      }
      if (built.degraded)
        log.warn("compaction transcript degraded to fit summary budget", {
          sessionID: input.sessionID,
          budget: summaryBudget,
        })

      let conversation = built.text
      const summarize = Effect.fnUntraced(function* (prompt: string) {
        const msg = summaryMessage()
        yield* session.updateMessage(msg)
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: input.sessionID,
          model,
        })
        const result = yield* processor.process({
          user: userMessage,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [],
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          ],
          model,
        })
        const stored = (yield* session.messages({ sessionID: input.sessionID })).find((item) => item.info.id === msg.id)
        return { msg, processor, result, stored, summary: stored ? summaryText(stored) : undefined }
      })

      let first = yield* summarize(promptFor(conversation))
      // provider 仍拒绝(估算偏差、模型实际上限更低)→ 按 SHRINK_STEPS 收缩目标体积,
      // 重建更小的转写并重试;重建不出更小内容(仅剩最新一轮/已不可再降)则放弃。
      if (first.result === "compact") {
        for (const step of SUMMARY_SHRINK_STEPS) {
          const target = Math.floor(Token.estimate(promptFor(conversation)) * step)
          const rebuilt = conversationWithin(msgs, Math.max(0, target - fixedEstimate))
          if (rebuilt.text === undefined || rebuilt.text === conversation) break
          conversation = rebuilt.text
          log.warn("compaction summary shrink retry", {
            sessionID: input.sessionID,
            step,
            target,
          })
          yield* session.removeMessage({ sessionID: input.sessionID, messageID: first.msg.id })
          first = yield* summarize(promptFor(conversation))
          if (first.result !== "compact") break
        }
      }
      const firstValidation = CompactionSummary.validate(first.summary)
      const overBudget =
        !!first.summary && Token.estimate(first.summary) > Math.ceil(target.summaryBudget * SUMMARY_OVER_BUDGET)
      const retry =
        first.result === "continue" &&
        !first.processor.message.error &&
        first.processor.message.finish &&
        !!first.summary &&
        (firstValidation.missingCore.length > 0 || overBudget)
      const attempt = retry
        ? yield* Effect.gen(function* () {
            yield* session.removeMessage({ sessionID: input.sessionID, messageID: first.msg.id })
            log.warn("compaction summary retry", {
              sessionID: input.sessionID,
              modelID: model.id,
              missing: firstValidation.missing,
              summary_tokens: first.summary ? Token.estimate(first.summary) : 0,
              summary_budget: target.summaryBudget,
              summary: first.summary,
            })
            // 缺章节走结构修复;章节齐但超预算走体量收紧 —— 两者共用一次重试机会。
            const fixes = [
              ...(firstValidation.missingCore.length > 0
                ? [
                    "Your previous summary was missing required sections.",
                    `Missing sections: ${firstValidation.missing.join(", ")}`,
                  ]
                : []),
              ...(overBudget
                ? [
                    `Your previous summary was about ${Token.estimate(first.summary!)} tokens, over the ~${target.summaryBudget}-token budget.`,
                    "Shorten it to under the budget while keeping every required section. Prefer fewer, denser bullets.",
                  ]
                : []),
            ]
            return yield* summarize(
              [
                ...fixes,
                "Return a corrected complete summary with every required heading, using (none) for empty sections.",
                "<invalid-summary>",
                first.summary,
                "</invalid-summary>",
                SUMMARY_TEMPLATE,
                "The following is the conversation history:",
                conversation,
              ].join("\n\n"),
            )
          })
        : first
      // 提纯体积闭环:收紧重试的产物同样复查 —— 仍超预算则接受落盘(渐进降密度,下轮
      // 触发的纯提纯出口保证继续收敛)并告警,不再静默放过。
      if (
        attempt !== first &&
        !!attempt.summary &&
        Token.estimate(attempt.summary) > Math.ceil(target.summaryBudget * SUMMARY_OVER_BUDGET)
      )
        log.warn("compaction summary still over budget after retry, accepted for progressive refinement", {
          sessionID: input.sessionID,
          modelID: model.id,
          summary_tokens: Token.estimate(attempt.summary!),
          summary_budget: target.summaryBudget,
        })
      const msg = attempt.msg
      const processor = attempt.processor
      const result = attempt.result

      if (result === "compact") {
        // 摘要请求超限的最后手段:降级到纯裁剪出口 —— 全量保留并清除巨型输出,
        // 而不是终止会话。清不出东西或有效体积仍放不下才是真死局。
        const cleared = yield* clearOversizedToolOutputs({
          sessionID: input.sessionID,
          messages: compactable,
          capTokens: toolClipCapTokens(usable({ cfg, model })),
        })
        const effectiveTotal = yield* estimateEffective({ messages: compactable, model, cfg })
        const fixedTokens = input.contextTokens ? input.contextTokens.system + input.contextTokens.tools : 0
        if (
          cleared.length > 0 &&
          (!input.contextTokens ||
            fixedTokens + effectiveTotal + Math.ceil(effectiveTotal * FLOOR_MARGIN_SHARE) < input.contextTokens.usable)
        ) {
          yield* session.removeMessage({ sessionID: input.sessionID, messageID: msg.id })
          replay = undefined
          return yield* finishClipOnly(cleared, "summary-request-overflow")
        }
        processor.message.error = new MessageV2.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : `Session too large to compact - the summary request (~${Token.estimate(promptFor(conversation))} tokens) stays above the model context limit (${summaryLimit} tokens) even after transcript degradation`,
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (processor.message.error || result === "stop") return "stop"

      const repaired = CompactionSummary.repair(attempt.summary)
      if (repaired.repaired.length && repaired.summary && attempt.stored) {
        const parts = attempt.stored.parts.filter((part): part is MessageV2.TextPart => part.type === "text")
        const firstPart = parts[0]
        if (firstPart) {
          yield* session.updatePart({ ...firstPart, text: repaired.summary })
          yield* Effect.forEach(
            parts.slice(1),
            (part) => session.removePart({ sessionID: input.sessionID, messageID: msg.id, partID: part.id }),
            { discard: true },
          )
        }
        log.warn("compaction summary repaired", {
          sessionID: input.sessionID,
          modelID: model.id,
          repaired: repaired.repaired,
          raw_summary: attempt.summary,
          final_summary: repaired.summary,
        })
      }
      const summary = repaired.summary
      const validation = CompactionSummary.validate(summary)
      if (processor.message.finish && !validation.valid) {
        processor.message.error = new MessageV2.APIError({
          message: summary
            ? `Context compaction returned an invalid summary. Missing sections: ${validation.missing.join(", ")}`
            : "Context compaction returned an empty summary.",
          isRetryable: false,
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        log.error("compaction summary invalid", {
          sessionID: input.sessionID,
          modelID: model.id,
          missing: validation.missing,
          duration_ms: Date.now() - startedAt,
          summary: summary ?? "",
        })
        return "stop"
      }

      const anchorID = selected.emptyTail ? input.parentID : selected.tail_start_id
      if (compactionPart && anchorID && compactionPart.tail_start_id !== anchorID) {
        compactionPart.tail_start_id = anchorID
        yield* session.updatePart(compactionPart)
      }
      // 保尾清除落盘:保留窗口内超配额阈值的已完成工具输出复用既有的 time.compacted
      // 标记(message-v2 渲染为 "[Old tool result content cleared]"),后续请求不再把
      // 巨型工具输出(如全文注入的 skill 文档)送进模型上下文。原文仍在存储中;
      // skill 类输出额外落一条"分段重读"提示,防止模型因内容被清而重新全量加载造成回环。
      const tailCleared: Array<{ tool: string; tokens: number; name?: string; dir?: string }> = []
      if (!selected.emptyTail && selected.tail_start_id) {
        const tailStart = compactable.findIndex((m) => m.info.id === selected.tail_start_id)
        if (tailStart >= 0) {
          const cleared = yield* clearOversizedToolOutputs({
            sessionID: input.sessionID,
            messages: compactable.slice(tailStart),
            capTokens: toolClipCapTokens(usable({ cfg, model })),
          })
          tailCleared.push(...cleared)
        }
      }
      if (tailCleared.length > 0)
        log.info("compaction tail tool outputs cleared", {
          sessionID: input.sessionID,
          cleared: tailCleared.length,
          freed: tailCleared.reduce((total, item) => total + item.tokens, 0),
          tools: tailCleared.map((item) => item.tool),
        })
      yield* writeSkillRereadNotice({
        sessionID: input.sessionID,
        agent: userMessage.agent,
        model: userMessage.model,
        cleared: tailCleared,
      })

      if (result === "continue" && input.auto) {
        if (replay) {
          // replay 预算:压缩后投影(固定成本+保尾+摘要+余量)之外留给回填正文的余量,
          // 与保尾同口径(usable×25%)封顶 —— replay 不再把巨型 pending 正文 verbatim 搬回
          // 压缩后的上下文(压缩后估算必然 < usable,preflight reject 不再可达)。
          const replayBudget = input.contextTokens
            ? Math.max(
                REPLAY_BUDGET_MIN,
                Math.min(
                  Math.floor(input.contextTokens.usable * REPLAY_BUDGET_SHARE),
                  input.contextTokens.usable -
                    input.contextTokens.system -
                    input.contextTokens.tools -
                    tailFloorTokens -
                    summaryFloorEstimate -
                    floorMargin,
                ),
              )
            : Math.floor(usable({ cfg, model }) * REPLAY_BUDGET_SHARE)
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          // 多个 text part 共享总预算:逐 part 扣减,防止各按全额回填把 N 份预算搬回
          // 上下文、超出压缩后剩余容量(clipReplayText 对 ≤0 预算回落到 400 字符兜底)。
          let replayRemaining = replayBudget
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            if (part.type === "text") {
              const clipped = replayTextPart(part, replayRemaining)
              replayRemaining -= Token.estimate(clipped.text)
              yield* session.updatePart({
                ...clipped,
                id: PartID.ascending(),
                messageID: replayMsg.id,
                sessionID: input.sessionID,
              })
              continue
            }
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? {
                    type: "text" as const,
                    text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
                    synthetic: true,
                    metadata: { compaction_replay: true },
                  }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) yield* writeContinueMessage()
      }

      if (result === "continue") {
        log.info("compaction completed", {
          sessionID: input.sessionID,
          modelID: model.id,
          providerID: model.providerID,
          input_tokens: processor.message.tokens.input,
          output_tokens: processor.message.tokens.output,
          duration_ms: Date.now() - startedAt,
          tail_start_id: anchorID,
          summary,
          target: target.target,
          fixed: target.fixed,
          tail_tokens: selected.emptyTail ? 0 : selected.tailTokens,
          summary_tokens: summary ? Token.estimate(summary) : 0,
        })
        EventV2.run(SessionEvent.Compaction.Ended.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          text: summary ?? "",
          include: anchorID,
        })
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
      message?: string
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
      // 手动压缩时附带显示文本(synthetic text part):make 等客户端把用户输入渲染为气泡;
      // 标准 UI 的 Message 组件会过滤 synthetic part,不会重复显示。
      if (input.message) {
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "text",
          text: input.message,
          synthetic: true,
        } satisfies MessageV2.TextPart)
      }
      EventV2.run(SessionEvent.Compaction.Started.Sync, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        reason: input.auto ? "auto" : "manual",
      })
    })

    return Service.of({
      isOverflow,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  return runPromise((svc) => svc.isOverflow(input))
}

export async function prune(input: { sessionID: SessionID }) {
  return runPromise((svc) => svc.prune(input))
}

export const create = fn(
  z.object({
    sessionID: SessionID.zod,
    agent: z.string(),
    model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
    auto: z.boolean(),
    overflow: z.boolean().optional(),
  }),
  (input) => runPromise((svc) => svc.create(input)),
)

export * as SessionCompaction from "./compaction"
