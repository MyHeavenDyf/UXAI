/**
 * 消息轮次分组工具 — 将 root + child session 的消息按用户提交轮次分组，
 * 计算每轮的时间范围和取消状态。
 */
import type { Message } from "@opencode-ai/sdk/v2/client"

export interface RoundItem {
  sessionID: string
  messageID: string
  time: number
}

export interface Round {
  startTime: number
  endTime?: number
  items: RoundItem[]
  cancelled: boolean
  error?: string
}

/**
 * 按"用户提交轮次"将 root session + child session 的消息分组。
 *
 * 分轮规则：
 * - 创建模式（首轮）：无 root 用户消息但存在更早的 child session → 边界为 0
 * - 修改模式（后续轮）：每条 root 用户消息（triage prompt）是一个新轮次边界
 *
 * 每轮收集落在 [roundStart, roundEnd) 时间窗口内的用户消息为 items，
 * 同时追踪最早创建时间 / 最晚完成时间，以及检测取消状态。
 *
 * @param rootId      root session ID
 * @param childIDs    child session ID 列表
 * @param getMessages 按 sessionID 返回该 session 的全部消息
 * @param getParts    按 messageID 返回该消息的 parts（用于检测 tool 取消）
 */
export function groupRounds(
  rootId: string,
  childIDs: string[],
  getMessages: (sessionID: string) => Message[],
  getParts: (messageID: string) => Array<Record<string, unknown>> | undefined,
): Round[] {
  const allRootMsgs = getMessages(rootId)
  const rootUserMsgs = allRootMsgs.filter((m) => m.role === "user")
  if (childIDs.length === 0 && rootUserMsgs.length === 0) return []

  const roundStarts: number[] = []
  const firstRootTime = rootUserMsgs.length > 0 ? (rootUserMsgs[0].time?.created ?? Infinity) : Infinity
  const hasEarlyChildren = childIDs.some((cid) => {
    const msgs = getMessages(cid)
    return (msgs[0]?.time?.created ?? Infinity) < firstRootTime
  })
  if (hasEarlyChildren) roundStarts.push(0)
  for (const m of rootUserMsgs) roundStarts.push(m.time?.created ?? 0)
  if (roundStarts.length === 0) return []

  return roundStarts.map((roundStart, ri): Round => {
    const roundEnd = ri < roundStarts.length - 1 ? roundStarts[ri + 1] : Infinity
    const items: RoundItem[] = []
    let startTime = roundStart === 0 ? Infinity : roundStart
    let endTime: number | undefined
    let cancelled = false

    const checkCancelled = (m: Message) => {
      if (cancelled || m.role !== "assistant") return
      const msgError = (m as Record<string, unknown>).error as Record<string, unknown> | undefined
      if (msgError?.name === "MessageAbortedError") {
        cancelled = true
        return
      }
      const parts = getParts(m.id)
      if (!parts) return
      for (const p of parts) {
        if (p.type !== "tool") continue
        const st = p.state as Record<string, unknown> | undefined
        if (st?.status === "error" && (st.error === "Cancelled" || st.error === "Tool execution aborted")) {
          cancelled = true
          return
        }
      }
    }

    const trackTime = (m: Message) => {
      const t = m.time as { created: number; completed?: number }
      if (t.created < startTime) startTime = t.created
      if (typeof t.completed === "number" && (!endTime || t.completed > endTime)) endTime = t.completed
    }

    for (const m of rootUserMsgs) {
      const t = m.time?.created ?? 0
      if (t < roundStart || t >= roundEnd) continue
      items.push({ sessionID: rootId, messageID: m.id, time: t })
      trackTime(m)
      const idx = allRootMsgs.findIndex((mm) => mm.id === m.id)
      const assistant = allRootMsgs.slice(idx + 1).find((mm) => mm.role === "assistant")
      if (assistant) { trackTime(assistant); checkCancelled(assistant) }
    }

    for (const childID of childIDs) {
      const childMsgs = getMessages(childID)
      const childCreated = childMsgs[0]?.time?.created ?? Infinity
      if (childCreated < roundStart || childCreated >= roundEnd) continue
      for (const m of childMsgs) {
        if (m.role === "user") items.push({ sessionID: childID, messageID: m.id, time: m.time?.created ?? 0 })
        trackTime(m)
        checkCancelled(m)
      }
    }

    items.sort((a, b) => a.time - b.time)
    if (startTime === Infinity) startTime = items.length > 0 ? items[0].time : Date.now()
    return { startTime, endTime, items, cancelled }
  })
}
