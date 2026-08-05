import { onCleanup, onMount } from "solid-js"
import { Binary } from "@opencode-ai/core/util/binary"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { createSessionQueueRunner } from "@/utils/session-queue-runner"
import {
  activeChatSession,
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
 *   1. 轮询（5s，无队列时 15s）从 localStorage 刷新队列数据到模块级 signal
 *   2. createSessionQueueRunner 提供 reactive level-triggered drain
 *   3. session_status 经 SSE 变化时 effect 立即重跑，无需等下一次轮询
 */
export function ChatFollowupQueueRunner() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  // 记录本 runner 为各 session 发出的最后一条消息 id,用于判定「该 turn 是否已出回复」。
  // 不能用 store.message 的最后一条(user 消息)做锚点:其 message.updated 可能延迟到达,
  // 那会让 busyOf 误以为上一条已完成而快速连发 → 服务端合并成单 turn 只回最后一条。
  const lastSent = new Map<string, string>()

  // 首次同步 + 轮询刷新 localStorage → signal
  // 动态间隔:有队列时 5s（尽快感知页面入队的新数据），无队列时 15s（降低 idle 开销）
  discoverAndSync()
  onMount(() => {
    const tick = () => {
      discoverAndSync()
      watchdogBusy()
      const hasQueues = Object.keys(allFollowupQueues()).length > 0
      timer = setTimeout(tick, hasQueues ? 5000 : 15000)
    }
    let timer = setTimeout(tick, 5000)
    onCleanup(() => clearTimeout(timer))
  })

  /**
   * busy 超时看门狗：session_status=busy 但最后一条 assistant 消息已完成超过 60s
   * → SSE 可能断连，乐观重置为 idle，让 drain 继续。
   * 只遍历有队列的 session（通常 1-3 个），每 5s/15s 跑一次，开销极小。
   */
  const watchdogBusy = () => {
    const queues = allFollowupQueues()
    for (const [sid, bucket] of Object.entries(queues)) {
      const dir = bucket.directory
      if (!dir) continue
      const [store, setStore] = globalSync.peek(dir, { bootstrap: true })
      if ((store.session_status[sid]?.type ?? "idle") !== "busy") continue
      const msgs = store.message[sid]
      if (!msgs?.length) continue
      const last = msgs[msgs.length - 1]
      if (last.role !== "assistant") continue
      const completed = (last.time as { completed?: number } | undefined)?.completed
      if (typeof completed !== "number") continue
      if (Date.now() - completed > 60_000) {
        setStore("session_status", sid, { type: "idle" })
      }
    }
  }

  const busyOf = (sid: string): boolean => {
    const bucket = allFollowupQueues()[sid]
    if (!bucket) return true
    const dir = bucket.directory
    if (!dir) return true

    // peek 内部由 ensureChild 管理生命周期（含 eviction + LRU），只读不 pin
    const [store] = globalSync.peek(dir, { bootstrap: true })

    const statusType = store.session_status[sid]?.type ?? "idle"
    const msgs = store.message[sid]
    const sentID = lastSent.get(sid)

    // session 明确 busy
    if (statusType === "busy") return true

    // 服务端在 createUserMessage 后立刻发 idle(回复还在异步生成),且 user 消息的
    // message.updated 事件可能延迟到达。只靠 session_status + 最后一条消息会让 runner
    // 误以为上一条已完成 → 连续快速发送,多条消息被服务端合并成一个 turn,只有最后一条有回复。
    // 因此以「本 runner 上次发出的消息」为锚点:只有在该消息之后出现完成的 assistant 回复
    // 才视为 idle 可 drain 下一条;即使 sent 消息的 message.updated 尚未到达,也视为 busy 等待。
    if (sentID) {
      // 已发出消息但 store 尚无任何消息(事件延迟)→ 等待
      if (!msgs || msgs.length === 0) return true
      const idx = Binary.search(msgs, sentID, (m) => m.id).index
      for (let i = idx; i < msgs.length; i++) {
        if (msgs[i].role === "assistant") {
          const completed = typeof (msgs[i].time as { completed?: number } | undefined)?.completed === "number"
          if (completed) {
            lastSent.delete(sid) // 本 turn 已出回复,解除锚点
            return false
          }
          return true // 回复流式中
        }
      }
      return true // sent 消息之后还没有 assistant 回复 → 等待
    }

    // 首条(尚未发出过):退回「最后一条消息」检查
    if (msgs && msgs.length > 0) {
      const last = msgs[msgs.length - 1]
      if (last.role === "user") return true
      if (last.role === "assistant") {
        const completed = typeof (last.time as { completed?: number } | undefined)?.completed === "number"
        if (!completed) return true
      }
    }
    return false
  }

  createSessionQueueRunner<FollowupItem>({
    buckets: () => {
      const all = allFollowupQueues()
      const active = activeChatSession()
      const result: Record<string, FollowupItem[]> = {}
      for (const [sid, bucket] of Object.entries(all)) {
        if (sid === active) continue // 页面正在处理该会话,由 flushQueueHead drain,避免重复发送
        if (bucket.items.length > 0) {
          result[sid] = bucket.items
        }
      }
      return result
    },
    isBusy: busyOf,
    shift: (sid) => shiftFollowupItem(sid),
    send: async (sid, item) => {
      const messageID = await sendFollowupBackground(globalSDK, globalSync, sid, item)
      if (messageID) lastSent.set(sid, messageID)
    },
  })

  return null
}
