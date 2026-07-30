import { createEffect } from "solid-js"

/**
 * 会话排队 drain 运行器（UI 无关 · 跨模块通用）—— SPEC-INS-027
 *
 * 背景：排队队列数据早已提到模块级，但「busy→idle 后弹出下一条」的 drain 触发器一直留在
 * 页面组件内（edge-triggered `on(isBusy,…,{defer})`）。页面一卸载（切 /skills 路由页 / 切相邻
 * agent tab）触发器就被 SolidJS dispose，会话后台跑完的 idle 边沿没人听 → 排队死等。
 *
 * 本内核把 drain 触发器做成 **level-triggered**（判据是「idle 且队列非空」这个状态，而非某一跳）
 * + **per-session in-flight 守卫**（保证一条一回合、不重复发），由调用方挂在**应用根常驻、脱离
 * 视图层**的 owner 下（见 octo.tsx 的 <InsightQueueRunner/>）。
 *
 * 泛型 + adapter：内核不认任何模块细节。队列数据 per (module, sessionID) 分桶、每模块各持一份、
 * 各起一个 runner 实例，天然隔离——内核只 drain 调用方喂进来的那份 buckets，无需查 session.agent。
 * 其他模块接入见 SPEC-INS-027 §5。
 */
export interface QueueRunnerAdapter<Item> {
  /** reactive：当前所有非空队列桶 { sessionID: Item[] }（读时自动追踪变化，驱动 level-triggered 对账） */
  buckets: () => Record<string, Item[]>
  /** reactive：某 session 是否忙。来源必须是全局 session_status，不是任何页面态 */
  isBusy: (sessionID: string) => boolean
  /** 弹掉并返回某 session 的队首（内部做去头的 store 写入）；空则返回 undefined */
  shift: (sessionID: string) => Item | undefined
  /** 页面无关的发送：把一条队列项发给指定 session。必须自包含，不依赖任何已挂载页面 */
  send: (sessionID: string, item: Item) => Promise<void>
}

/**
 * 一次 drain 对账（level-triggered 的纯逻辑，抽出以便直接单测，不依赖 Solid 调度时序）。
 * 在 createEffect 里被调用时，读 `buckets()` 与 `isBusy()` 即建立响应式追踪。
 *
 * @param inflight 由调用方持有、跨多次对账保留的守卫集合
 */
export function runDrainPass<Item>(adapter: QueueRunnerAdapter<Item>, inflight: Set<string>): void {
  const buckets = adapter.buckets() // 追踪队列变化
  for (const sid of Object.keys(buckets)) {
    const q = buckets[sid]
    if (!q?.length) continue

    const busy = adapter.isBusy(sid) // 追踪该 sid 的 busy 变化
    if (busy) {
      // 已进入 turn → 清 in-flight，等它跑完再回到 idle 时 drain 下一条
      inflight.delete(sid)
      continue
    }
    if (inflight.has(sid)) continue // 已 dispatch、还没转 busy → 别重复发同一条

    const item = adapter.shift(sid)
    if (!item) continue

    inflight.add(sid)
    void adapter.send(sid, item).catch((err) => {
      // 发送失败：释放守卫，避免该 session 永久卡住(失败项已在 shift 时消费、不自动重试,
      // 与既有 flushQueueHead 行为一致);剩余队列保留可见——与既有 no-feedback watchdog
      // 同一风险类,不新增处理(SPEC-INS-007 §3.3.3)。
      inflight.delete(sid)
      console.warn("[octo:queue] drain send failed", { sid, err })
    })
  }
}

/**
 * 在一个 Solid owner 下调用一次；内部建 createEffect。owner 销毁时 effect 自动清理。
 * 挂载点要选**跨所有 tab / 路由常驻**的层级（GlobalSyncProvider 内），否则又回到「随页面卸载而死」。
 */
export function createSessionQueueRunner<Item>(adapter: QueueRunnerAdapter<Item>): void {
  // 已 dispatch、等待该 turn 真正开始（status 转 busy）的 sid。防「发出后 status 还没转 busy」的
  // 窗口里被同一 effect 重复触发，保证一条一回合。跨多次对账保留。
  const inflight = new Set<string>()
  createEffect(() => runDrainPass(adapter, inflight))
}
