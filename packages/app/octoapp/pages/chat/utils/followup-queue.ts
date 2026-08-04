import { createSignal } from "solid-js"
import type { FollowupDraft } from "@/components/prompt-input/submit"

export type FollowupItem = FollowupDraft & { id: string }

interface FollowupStoreData {
  items: Record<string, FollowupItem[] | undefined>
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
  edit: Record<string, { id: string } | undefined>
}

interface QueueBucket {
  items: FollowupItem[]
  directory: string
  localStorageKey: string
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
}

const FOLLOWUP_KEY_SUFFIX = ":workspace:followup"

const [queues, setQueues] = createSignal<Record<string, QueueBucket>>({})

// 当前 chat 页面正在查看的 sessionID（页面挂载时设置、卸载时清除）。
// runner 用它跳过「页面正在处理」的会话,避免 runner 与页面级 flushQueueHead 竞争
// 导致同一条排队被重复发送（页面 persisted 内存与 runner 写回的 localStorage 会不同步）。
const [activeSession, setActiveSession] = createSignal<string | undefined>(undefined)

/** 页面在查看某会话时调用,让 runner 不与该会话的页面级 drain 竞争 */
export function setActiveChatSession(sid: string | undefined): void {
  setActiveSession(sid)
}

export function activeChatSession(): string | undefined {
  return activeSession()
}

let lastJSON = ""

function serializeQueues(q: Record<string, QueueBucket>): string {
  const stripped: Record<string, { items: FollowupItem[]; directory: string }> = {}
  for (const [sid, bucket] of Object.entries(q)) {
    stripped[sid] = { items: bucket.items, directory: bucket.directory }
  }
  return JSON.stringify(stripped)
}

/**
 * 扫描所有 localStorage 键，找出所有 followup 持久化数据，
 * 同步到模块级 signal。若数据与上一次无变化则跳过 signal 更新，
 * 避免触发不必要的 level-triggered drain 对账。
 */
export function discoverAndSync(): void {
  const next: Record<string, QueueBucket> = {}

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.endsWith(FOLLOWUP_KEY_SUFFIX)) continue

    const raw = localStorage.getItem(key)
    if (!raw) continue

    let data: FollowupStoreData | undefined
    try {
      data = JSON.parse(raw) as FollowupStoreData
    } catch {
      continue
    }

    if (!data?.items) continue

    for (const [sid, items] of Object.entries(data.items)) {
      if (!items || !Array.isArray(items) || items.length === 0) continue
      const dir = items[0]?.sessionDirectory
      if (!dir) continue

      // 跳过 paused 的 session
      if (data.paused?.[sid]) continue
      // 跳过队首是 failed 项的 session
      if (data.failed?.[sid] && items[0]?.id === data.failed[sid]) continue

      next[sid] = {
        items,
        directory: dir,
        localStorageKey: key,
        failed: data.failed ?? {},
        paused: data.paused ?? {},
      }
    }
  }

  // 只在数据实际变化时才更新 signal，避免无意义的 drain 对账
  const nextJSON = serializeQueues(next)
  if (nextJSON !== lastJSON) {
    lastJSON = nextJSON
    setQueues(next)
  }
}

/** 反应式：所有当前非空 followup 队列，keyed by sessionID */
export function allFollowupQueues(): Record<string, QueueBucket> {
  return queues()
}

/** 每次 drain 对账前强制刷新，保证 runner 读到最新的 localStorage 状态 */
export function refreshAndGetQueues(): Record<string, QueueBucket> {
  discoverAndSync()
  return queues()
}

/**
 * 弹出指定 session 的队首项，并把更新后的数据写回 localStorage。
 * 返回弹出的 item，或 undefined（队列为空/不存在）。
 */
export function shiftFollowupItem(sessionID: string): FollowupItem | undefined {
  const current = queues()
  const bucket = current[sessionID]
  if (!bucket || bucket.items.length === 0) return undefined

  const [head, ...tail] = bucket.items
  if (!head) return undefined

  // 原地更新 signal
  const updated: Record<string, QueueBucket> = {}
  for (const sid of Object.keys(current)) {
    if (sid === sessionID) {
      if (tail.length === 0) continue // 空桶不保留
      updated[sid] = { ...bucket, items: tail }
    } else {
      updated[sid] = current[sid]
    }
  }
  lastJSON = serializeQueues(updated)
  setQueues(updated)

  // 写回 localStorage（只更新 items，failed/paused 保留 localStorage 中最新的值，避免竞态覆盖）
  writeFollowupStore(bucket.localStorageKey, sessionID, tail)

  return head
}

function writeFollowupStore(
  localStorageKey: string,
  sessionID: string,
  items: FollowupItem[],
): void {
  // 重新读取最新的 localStorage 值，避免与页面内的 setFollowup 产生竞态
  const raw = localStorage.getItem(localStorageKey)
  if (!raw) return

  let data: FollowupStoreData
  try {
    data = JSON.parse(raw) as FollowupStoreData
  } catch {
    return
  }

  data.items[sessionID] = items.length > 0 ? items : undefined

  try {
    localStorage.setItem(localStorageKey, JSON.stringify(data))
  } catch {
    // quota exceeded or other error, silently fail
  }
}