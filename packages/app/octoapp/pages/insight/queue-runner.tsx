import { getOwner, runWithOwner } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { createSessionQueueRunner } from "@/utils/session-queue-runner"
import { allQueues, updateSessionQueue, type QueuedSend } from "./utils/send-queue"
import { sendQueuedItem } from "./utils/queue-drain"

/**
 * insight 排队 drain 运行器（headless，SPEC-INS-027）
 *
 * 挂在 octo.tsx 的 GlobalSyncProvider 之内、Router 之外——**跨所有 tab / 路由常驻**，
 * insight/chat/make/pattern/skills 页面来回切都不会卸载它。这样会话在后台跑完转 idle 时，
 * 是它（而非早已随页面卸载而死的 in-page effect）把下一条排队发出去。
 *
 * 隔离：只 drain insight 自己的 send-queue（只可能装 insight 会话），无需查 session.agent。
 * 其他模块若要同款排队，各起各的 runner（见 SPEC-INS-027 §5），互不串场。
 */
export function InsightQueueRunner() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  // 本组件的稳定 owner：用它承载 child(dir) 的 pin，保证有排队的目录 child store 常驻、
  // session_status 持续经 SSE 更新（否则目录 store 在 TTL 后被驱逐，后台就收不到 idle）。
  // pinForOwner 幂等（同 owner+dir 只 pin 一次），故在 effect 里反复调用无 pin 抖动。
  const owner = getOwner()

  const busyOf = (sid: string): boolean => {
    const head = allQueues()[sid]?.[0]
    const dir = head?.directory
    if (!dir) return true // 无 directory 无法发送 → 视为忙，不 drain（避免空转）
    // 保活：在**稳定的组件 owner** 下 pin 该目录（pinForOwner 幂等），使其 child store 不被 TTL 驱逐、
    // session_status 持续经 SSE 更新。runWithOwner 只用于把 pin 挂到组件 owner，其内部的响应式读取
    // 不参与本 effect 追踪——故状态的响应式读取放到下面 peek（在 effect 追踪作用域内）完成。
    runWithOwner(owner, () => globalSync.child(dir, { bootstrap: true }))
    // 读状态：peek 不再 pin，返回同一个 child store；在此（drain effect 的追踪作用域内）读
    // session_status → status 变化时 effect 会重跑（level-triggered 的关键）。
    const [store] = globalSync.peek(dir, { bootstrap: true })
    return (store.session_status[sid]?.type ?? "idle") === "busy"
  }

  createSessionQueueRunner<QueuedSend>({
    buckets: () => allQueues(),
    isBusy: busyOf,
    shift: (sid) => {
      const head = allQueues()[sid]?.[0]
      if (!head) return undefined
      updateSessionQueue(sid, (q) => q.slice(1))
      return head
    },
    send: (sid, item) => sendQueuedItem(globalSDK, sid, item),
  })

  return null
}
