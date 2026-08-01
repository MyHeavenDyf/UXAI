import { getOwner, onCleanup, onMount, runWithOwner } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { createSessionQueueRunner } from "@/utils/session-queue-runner"
import {
  allFollowupQueues,
  discoverAndSync,
  shiftFollowupItem,
} from "./utils/followup-queue"
import { sendFollowupBackground } from "./utils/followup-drain"
import type { FollowupItem } from "./utils/followup-queue"

/**
 * chat followup 排队 drain 运行器（headless · reactive + 轮询驱动）
 *
 * 挂在 octo.tsx 的 GlobalSyncProvider 之内、Router 之外——跨所有 tab / 路由常驻。
 * chat 页面卸载后（切到 /insight /skills 等），由本 runner 继续 drain 排队的 followup。
 *
 * 数据桥：通过 localStorage 与 session.tsx 的 persisted() store 共享数据。
 * makePersisted 的 setState 同步写 localStorage，保证数据无丢失。
 *
 * 架构（对齐 insight queue-runner）：
 *   1. 轮询（2s）从 localStorage 刷新队列数据到模块级 signal
 *   2. createSessionQueueRunner 提供 reactive level-triggered drain
 *   3. session_status 经 SSE 变化时 effect 立即重跑，无需等下一次轮询
 */
export function ChatFollowupQueueRunner() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const owner = getOwner()

  // 首次同步 + 轮询刷新 localStorage → signal
  discoverAndSync()
  onMount(() => {
    const timer = setInterval(() => discoverAndSync(), 2000)
    onCleanup(() => clearInterval(timer))
  })

  const busyOf = (sid: string): boolean => {
    const bucket = allFollowupQueues()[sid]
    if (!bucket) return true
    const dir = bucket.directory
    if (!dir) return true
    runWithOwner(owner, () => globalSync.child(dir, { bootstrap: true }))
    const [store] = globalSync.peek(dir, { bootstrap: true })
    return (store.session_status[sid]?.type ?? "idle") === "busy"
  }

  createSessionQueueRunner<FollowupItem>({
    buckets: () => {
      const all = allFollowupQueues()
      const result: Record<string, FollowupItem[]> = {}
      for (const [sid, bucket] of Object.entries(all)) {
        if (bucket.items.length > 0) {
          result[sid] = bucket.items
        }
      }
      return result
    },
    isBusy: busyOf,
    shift: (sid) => shiftFollowupItem(sid),
    send: (sid, item) => sendFollowupBackground(globalSDK, globalSync, sid, item),
  })

  return null
}
