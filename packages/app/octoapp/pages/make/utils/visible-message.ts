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
 * 自动压缩回填消息判定（服务端 compaction.ts replay 路径）。
 *
 * 上下文超限时自动压缩把 pending 用户消息折叠进摘要后,会以新 user message 回填原文续跑:
 * text part 带 metadata.compaction_replay（非 synthetic,与共享 UI UserMessageDisplay 同判定）。
 * 无 replay 时的续跑合成消息带 synthetic + metadata.compaction_continue。
 * 这两类消息不显示用户气泡（InsightTurn 渲染分割线提示）,但必须保留在 userMessages 里 ——
 * 续跑的 assistant 回复挂在该轮之下,过滤掉整轮会让续跑内容消失。
 */
export type PartLike = { type: string; synthetic?: boolean; metadata?: unknown; [key: string]: unknown }

function hasMarker(metadata: unknown, key: string): boolean {
  return typeof metadata === "object" && metadata !== null && (metadata as Record<string, unknown>)[key] === true
}

export function isHiddenCompactionTurn(parts: readonly PartLike[] | undefined): boolean {
  const list = parts ?? []
  if (list.some((part) => part.type === "text" && hasMarker(part.metadata, "compaction_replay"))) return true
  if (list.some((part) => part.type === "compaction")) return false
  return list.some(
    (part) => part.type === "text" && part.synthetic === true && hasMarker(part.metadata, "compaction_continue"),
  )
}
