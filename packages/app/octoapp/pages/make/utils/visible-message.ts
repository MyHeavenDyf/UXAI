import type { Message, Part } from "@opencode-ai/sdk/v2/client"

/**
 * InsightTurn 可见 user 消息判定,与 userMessages memo 的过滤逻辑一致。
 * 供三处共用: userMessages 过滤、sendMessage 发送后自愈校验(Fix 8)、
 * 切换 session 完整性校验(Fix 9)。
 *
 * 手动 /compact 压缩消息带 synthetic text part(用户输入回显),需要显示;
 * 自动压缩(仅 compaction part,无 text part)保持隐藏。
 */
export function isVisibleUserMessage(message: Message, parts: Part[] | undefined): boolean {
  if (message.role !== "user") return false
  const list = parts ?? []
  if (list.length === 0) return false
  if (list.some((part) => part.type === "compaction")) return list.some((part) => part.type === "text")
  return true
}

type TextLikePart = { type: string; synthetic?: boolean; metadata?: Record<string, unknown> }

/** make 页隐藏用户气泡的 task 子代理(路由派发的子会话) */
const TASK_CHILD_AGENTS = new Set(["octo_design", "octo_code", "plan"])

/**
 * task 子会话内部 user 消息判定:路由派发的 task prompt、question 表单回填等。
 * agent 是子代理且消息不属于主会话,非用户输入——与 make 页 InsightTurn
 * hideUserBubble 同口径,用户气泡与对话锚点都不应生成。
 */
export function isHiddenTaskPromptMessage(message: Message, mainSessionID: string | undefined): boolean {
  if (!mainSessionID) return false
  const sessionID = message.sessionID || mainSessionID
  return sessionID !== mainSessionID && TASK_CHILD_AGENTS.has(message.agent ?? "")
}

/**
 * 自动压缩续跑注入消息(无 compaction part):overflow 回放(compaction_replay)与
 * "Continue if you have next steps..."(compaction_continue),均为 synthetic text。
 * turn 必须保留渲染(否则续跑 assistant 输出丢失),但用户气泡/锚点不显示。
 */
export function isCompactionInjectedMessage(parts: Array<TextLikePart> | undefined): boolean {
  const list = parts ?? []
  if (list.length === 0) return false
  const injected = list.some((part) => part.type === "text" && isCompactionInjectedPart(part))
  return injected && !list.some((part) => part.type === "text" && !part.synthetic)
}

function isCompactionInjectedPart(part: TextLikePart): boolean {
  if (part.type !== "text") return false
  const metadata = part.metadata
  return metadata?.compaction_replay === true || metadata?.compaction_continue === true
}
