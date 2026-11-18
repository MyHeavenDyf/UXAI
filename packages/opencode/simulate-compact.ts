// 用真实埋点数据(compact_20261116-103623_no2_before.txt,内网 no2 会话)走一遍新压缩决策链:
// select 选尾(有效体积/空尾兜底)→ 地板投影(实际尾部+余量)→ 摘要转写降级 → 压缩后投影。
// 场景 A:原始形态 —— 两份 ~24.8 万字符 skill 文档以 user 文本注入(巨型用户正文)
// 场景 B:重构形态 —— 第二份文档改为 skill 工具输出落在轮末(本分支修复的核心场景)
// 选尾/配额/预算直接 import compaction.ts 的真实实现;走查与地板为同口径镜像。
import {
  clipTailToolOutputs,
  conversationWithin,
  targetBudget,
  toolClipCapTokens,
} from "./src/session/compaction"
import { toModelMessages, type MessageV2 } from "./src/session/message-v2"
import { MessageID, PartID, SessionID } from "./src/session/schema"
import type { Provider } from "@/provider/provider"
import { Token } from "@/util/token"

const dump = await Bun.file("../../analysis/octo-compact-analysis/compact_20261116-103623_no2_before.txt").text()
const idx = dump.indexOf("===== MESSAGES PREPARED FOR THE AI =====")
type DumpMsg = { role?: string; content?: Array<{ type?: string; text?: string }> }
const uiMsgs = JSON.parse(dump.slice(idx + "===== MESSAGES PREPARED FOR THE AI =====".length).trim()) as DumpMsg[]

// 埋点头部还原的真实数字
const SYSTEM = 3653
const TOOLS = 21790
const FIXED_ESTIMATE = 500 // buildPrompt+SUMMARY_TEMPLATE 固定开销的近似值
const SUMMARY_FLOOR = 2_000

const cfg = {} as Parameters<typeof targetBudget>[0]["cfg"]

const model = (context: number) =>
  ({
    id: "GLM-V5.2",
    providerID: "w3",
    name: "GLM-V5.2",
    limit: { context, input: undefined, output: 8192 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  }) as unknown as Provider.Model

const texts = (m: DumpMsg) => (m.content ?? []).map((c) => c.text ?? "")

function userMsg(texts: string[]) {
  const id = MessageID.ascending()
  const sessionID = SessionID.descending()
  return {
    info: {
      id,
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: "w3", modelID: "GLM-V5.2" },
      time: { created: 0 },
    },
    parts: texts.map((text) => ({
      id: PartID.ascending(),
      messageID: id,
      sessionID,
      type: "text",
      text,
    })),
  } as MessageV2.WithParts
}

function assistantMsg(parts: MessageV2.Part[]) {
  const sessionID = SessionID.descending()
  return {
    info: {
      id: MessageID.ascending(),
      role: "assistant",
      sessionID,
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "GLM-V5.2",
      providerID: "w3",
      parentID: MessageID.ascending(),
      time: { created: 0 },
      finish: "end_turn",
    },
    parts,
  } as MessageV2.WithParts
}

const textPartOf = (text: string) => {
  const id = MessageID.ascending()
  const sessionID = SessionID.descending()
  return {
    id: PartID.ascending(),
    messageID: id,
    sessionID,
    type: "text",
    text,
  } as MessageV2.Part
}

// —— 估算:与 compaction.ts estimate 同口径(toModelMessages → JSON.stringify → Token.estimate) ——
const estimate = async (messages: MessageV2.WithParts[], mdl: Provider.Model) =>
  Token.estimate(JSON.stringify(await toModelMessages(messages, mdl)))

type SelectOutcome =
  | { kind: "tail"; tailStart: number; tailTokens: number }
  | { kind: "empty-tail" }
  | { kind: "noop"; reason: string }

// 镜像 compaction.ts select():turns 划分 → 从最新轮往回收(有效体积)→ splitTurn(消息粒度)
// clip=false 时退化为旧实现的 verbatim 体积估算(无工具输出清除),用于新旧对照。
async function selectMirror(
  messages: MessageV2.WithParts[],
  mdl: Provider.Model,
  clip = true,
): Promise<SelectOutcome> {
  const usableTokens = Math.floor(mdl.limit.context * 0.85)
  // 镜像 targetBudget:固定成本扣除后按剩余空间收紧保尾(与 compaction.ts select 同口径)
  const budget = targetBudget({ cfg, model: mdl, contextTokens: { system: SYSTEM, tools: TOOLS, usable: usableTokens } }).tailBudget
  const cap = clip ? toolClipCapTokens(usableTokens) : Number.POSITIVE_INFINITY
  const all: Array<{ start: number; end: number }> = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].info.role !== "user") continue
    all.push({ start: i, end: messages.length })
  }
  for (let i = 0; i < all.length - 1; i++) all[i]!.end = all[i + 1]!.start
  if (!all.length) return { kind: "noop", reason: "no-turns" }

  let total = 0
  let keep: { start: number } | undefined
  for (let i = all.length - 1; i >= 0; i--) {
    const turn = all[i]!
    const size = await estimate(clipTailToolOutputs(messages.slice(turn.start, turn.end), cap), mdl)
    if (total + size <= budget) {
      total += size
      keep = { start: turn.start }
      continue
    }
    for (let start = turn.start + 1; start < turn.end; start++) {
      const splitSize = await estimate(clipTailToolOutputs(messages.slice(start, turn.end), cap), mdl)
      if (splitSize <= budget - total) {
        keep = { start }
        break
      }
    }
    break
  }
  if (!keep) return { kind: "empty-tail" }
  if (keep.start === 0) return { kind: "noop", reason: "fits-budget" }
  return {
    kind: "tail",
    tailStart: keep.start,
    tailTokens: await estimate(clipTailToolOutputs(messages.slice(keep.start), cap), mdl),
  }
}

const chars = (m: MessageV2.WithParts) =>
  m.parts.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length
    if (part.type === "tool" && part.state.status === "completed") return sum + part.state.output.length
    return sum
  }, 0)

const rawTokens = (m: MessageV2.WithParts) =>
  Token.estimate(
    JSON.stringify(m.parts.map((p) => (p.type === "text" ? p.text : p.type === "tool" && p.state.status === "completed" ? p.state.output : ""))),
  )

async function scenario(name: string, head: MessageV2.WithParts[], limits: number[]) {
  console.log(`\n========== ${name} ==========`)
  head.forEach((m, i) => console.log(`  msg${i} ${m.info.role}: ${chars(m)} chars ≈ ${rawTokens(m)} tokens(裸估算)`))
  for (const limit of limits) {
    const mdl = model(limit)
    const usable = Math.floor(limit * 0.85)
    const t = targetBudget({ cfg, model: mdl, contextTokens: { system: SYSTEM, tools: TOOLS, usable } })
    const budget = t.tailBudget
    const cap = toolClipCapTokens(usable)
    const outcome = await selectMirror(head, mdl)
    const oldSelect = await selectMirror(head, mdl, false)

    console.log(`\n--- 模型上限 ${limit} | usable ${usable} | 目标线 ${t.target}(fixed ${t.fixed}, 可动 ${t.available}) | 保尾预算 ${budget} | 摘要预算 ${t.summaryBudget}${t.fallback ? "(小模型兜底)" : ""} | 工具输出阈值 ${cap} ---`)
    console.log(`select(新): ${JSON.stringify(outcome)}`)
    console.log(`select(旧): ${JSON.stringify(oldSelect)}`)
    if (oldSelect.kind === "empty-tail" && outcome.kind !== "empty-tail")
      console.log(`  ↳ 旧实现 unsplittable-tail → "Nothing to compact" 错误放弃(会话死);新实现保尾成功`)
    else if (outcome.kind === "empty-tail")
      console.log(`  ↳ 走查均无锚点:旧实现 unsplittable → "Nothing to compact" 错误放弃(会话死);新实现空尾兜底 → 全量折叠进摘要`)

    const tailFloor = outcome.kind === "tail" ? outcome.tailTokens : 0
    const floorBase = SYSTEM + TOOLS + tailFloor + SUMMARY_FLOOR
    const margin = Math.max(1_000, Math.ceil(floorBase * 0.08))
    const newFloor = floorBase + margin
    const oldFloor = SYSTEM + TOOLS + budget + SUMMARY_FLOOR
    console.log(`地板(新投影): ${SYSTEM} + ${TOOLS} + 实际尾部 ${tailFloor} + 摘要 ${SUMMARY_FLOOR} + 余量 ${margin} = ${newFloor} → ${newFloor >= usable ? "拒绝(真无解)" : "放行"}`)
    console.log(`地板(旧公式): ${oldFloor} → ${oldFloor >= usable ? "拒绝(预算上限误杀)" : "放行"}`)

    const transcriptHead = outcome.kind === "tail" ? head.slice(0, outcome.tailStart) : head
    const summaryBudget = limit - Math.max(16_000, Math.floor(limit * 0.15)) - FIXED_ESTIMATE
    const built = conversationWithin(transcriptHead, summaryBudget)
    console.log(`摘要转写(head ${transcriptHead.length} 条, 预算 ${summaryBudget}): ${
      built.text === undefined
        ? "放不下 → 快速失败"
        : `${Token.estimate(built.text)} tokens ${built.degraded ? "(降级)" : "(全文)"}`
    }`)
    if (built.text) {
      const dup = built.text.match(/duplicate content omitted/g)?.length ?? 0
      console.log(`  skill 重复注入折叠: ${dup} 份`)
    }
    const projected = SYSTEM + TOOLS + SUMMARY_FLOOR + tailFloor
    const projectedTarget = SYSTEM + TOOLS + t.summaryBudget + tailFloor
    console.log(`压缩后投影: system+tools+摘要+尾部 ≈ ${projected} → ${projected < usable ? "上下文复活 ✓" : "仍超限 ✗"}`)
    console.log(`目标线投影: system+tools+摘要预算+实际尾部 ≈ ${projectedTarget} vs 目标 ${t.target} → ${projectedTarget <= t.target ? "达标 ✓" : "超线(best-effort)"}`)
  }
  return
}

// 场景 A:原始 no2 形态 —— 两份巨型 skill 文档都以 user 文本注入
const headA: MessageV2.WithParts[] = [
  userMsg(texts(uiMsgs[0]!)),
  assistantMsg(texts(uiMsgs[1]!).map(textPartOf)),
  userMsg(texts(uiMsgs[2]!)),
]

// 场景 B:第二份文档改为 skill 工具输出落在轮末(内网 68k 场景,真实文档体积)
const asst2Id = MessageID.ascending()
const headB: MessageV2.WithParts[] = [
  userMsg(texts(uiMsgs[0]!)),
  assistantMsg(texts(uiMsgs[1]!).map(textPartOf)),
  userMsg(["请用 h-design-compliance-score 评估一下刚才生成的 HTML 是否符合设计规范"]),
  assistantMsg([
    {
      id: PartID.ascending(),
      messageID: asst2Id,
      sessionID: SessionID.descending(),
      type: "tool",
      callID: "call-sim-1",
      tool: "skill",
      state: {
        status: "completed",
        input: { name: "h-design-compliance-score" },
        output: texts(uiMsgs[2]!).join("\n"),
        title: "Loaded skill: h-design-compliance-score",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    } as MessageV2.Part,
  ]),
]

await scenario("场景 A|真实 no2 数据:巨型 skill 文档以 user 文本注入(空尾兜底路径)", headA, [
  128_000,
  200_000,
  68_000,
  64_000,
])

await scenario("场景 B|同一文档作为 skill 工具输出落在轮末(有效体积+清除路径)", headB, [
  128_000,
  68_000,
])

// 场景 B 附证:标记 time.compacted 后的尾部渲染(message-v2 既有契约)
{
  const mdl = model(68_000)
  const outcome = await selectMirror(headB, mdl)
  if (outcome.kind === "tail") {
    const tail = headB.slice(outcome.tailStart)
    const before = await estimate(tail, mdl)
    const marked = tail.map((m) =>
      m.info.role !== "assistant"
        ? m
        : ({
            ...m,
            parts: m.parts.map((part) => {
              if (part.type !== "tool" || part.state.status !== "completed") return part
              if (Token.estimate(part.state.output) <= toolClipCapTokens(Math.floor(mdl.limit.context * 0.85)))
                return part
              return { ...part, state: { ...part.state, time: { ...part.state.time, compacted: Date.now() } } }
            }),
          } as MessageV2.WithParts),
    )
    const after = await estimate(marked, mdl)
    const rendered = JSON.stringify(await toModelMessages(marked, mdl))
    console.log(`\n========== 场景 B 附证|68k 标记后尾部渲染 ==========`)
    console.log(`尾部有效体积: 标记前 ${before} tokens → 标记后 ${after} tokens`)
    console.log(`渲染含占位符: ${rendered.includes("[Old tool result content cleared]")}`)
    console.log(`skill 全文已从模型上下文消失: ${!rendered.includes(texts(uiMsgs[2]!).join("\n").slice(0, 200))}`)
  }
}
