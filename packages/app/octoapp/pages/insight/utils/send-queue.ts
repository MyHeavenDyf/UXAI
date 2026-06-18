import { createSignal } from "solid-js"

/**
 * 发送排队队列(SPEC-INS-007 §3.3.3)
 *
 * - 粒度:per sessionID(分桶);天然隔离,A 的排队不会错发到 B(§3.3.5)
 * - 存储:模块级内存 Map,跨 session 且跨顶层 tab(chat/design/insight)切换常驻——
 *   insight 页在切走 tab 时会卸载,组件内 signal 会被销毁导致排队丢失;故提到模块级。
 *   空桶在更新时自动删除,避免堆积;整页刷新(reload)才重置,符合预期。
 *
 * 注意:模块级 createSignal 没有 SolidJS owner,但只持有纯数据、无 timer/订阅,
 * 无需 onCleanup;在反应式上下文里读 sessionQueue() 会自动追踪变化。
 */

const [queues, setQueues] = createSignal<Record<string, string[]>>({})

/** reactive:当前 session 的队列(空 id 视为空队列) */
export function sessionQueue(sid: string | undefined): string[] {
  if (!sid) return []
  return queues()[sid] ?? []
}

/** 更新指定 session 的队列;结果为空则删除该键,避免空桶堆积 */
export function updateSessionQueue(sid: string | undefined, updater: (q: string[]) => string[]): void {
  if (!sid) return
  setQueues((all) => {
    const next = updater(all[sid] ?? [])
    if (next.length === 0) {
      if (!(sid in all)) return all
      const { [sid]: _removed, ...rest } = all
      return rest
    }
    return { ...all, [sid]: next }
  })
}

/** 清空指定 session 的队列(abort 用) */
export function clearSessionQueue(sid: string | undefined): void {
  updateSessionQueue(sid, () => [])
}
