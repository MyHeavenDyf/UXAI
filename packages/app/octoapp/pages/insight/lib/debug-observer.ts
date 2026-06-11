// Insight 内网 debug 观测层 —— SPEC-INS-011 阶段1
// 自包含于 insight/lib/;不动上游核心;无 UI 入口;无自动上报。
// 文档:docs/specs/ui/insight-debug-toolkit.md
import type { Event, Message, Part } from "@opencode-ai/sdk/v2/client"
import { getDesktopApi } from "./electron-api"

const LOG = "[octo:event]"

// 环形缓冲容量
// ring 容量(内存 = IndexedDB 持久化上限,§5.5)
const EVENT_RING_CAP = 500
const SEND_RING_CAP = 50
const LOG_RING_CAP = 200
// 高频 delta 聚合间隔
const DELTA_FLUSH_MS = 1000

export type DebugMode = "quiet" | "compact" | "verbose"

/** doSendPrompt 每次发送时回灌的一条记录 */
export type SendRecord = {
  ts: number
  source: string
  sessionID: string
  messageID: string
  model: { providerID: string; modelID: string } | undefined
  modelResolved: boolean
  statusAtSend: string
  cleanText: string
  uploadBlock: string
  attachmentsCount: number
  endpoint: string
}

/** §4.6.3 console.error/warn 镜像 + §4.6.2 未捕获异常 */
export type LogEntry = {
  ts: number
  source: "console.error" | "console.warn" | "console.log" | "window.error" | "unhandledrejection"
  args: unknown[]
}

// §4.6.1: 全字段缓冲 —— 捕获时存完整 properties,展示时才精简
type EventEntry = {
  ts: number
  type: string
  properties: Record<string, unknown>
}

type AnyEvent = { type: string; properties?: Record<string, unknown> }

export type DebugDeps = {
  // useGlobalSDK() 返回值子集
  globalSDK: {
    url?: string
    event: {
      listen: (cb: (e: { name: string; details: Event }) => void) => () => void
    }
  }
  // useSync().data —— 读当前目录 child store
  syncData: {
    message: Record<string, Message[] | undefined>
    part: Record<string, Part[] | undefined>
    session_status: Record<string, { type?: string } | undefined>
    permission: Record<string, unknown[] | undefined>
    question: Record<string, unknown[] | undefined>
  }
  // 响应式读当前 session id（() => params.id）
  currentSessionID: () => string | undefined
}

export type InsightDebug = {
  recordSend: (rec: SendRecord) => void
  dispose: () => void
}

/** §5.1 snapshot 参数 */
export type SnapshotOpts = {
  last?: string          // "30s" | "2m" 相对时长
  since?: string         // "14:30" 绝对 | "2m" 相对
  until?: string
  around?: string        // messageID
  window?: string        // around 的前后窗口宽度（总宽，±各半）
  profile?: "no-feedback" | "stuck" | "errors" | "blank" | "upload"
  types?: string[]       // 直接按 event.type / 来源标签过滤
  full?: boolean         // 附 message/part dump
  events?: number        // 导出条数上限
}

// ── 事件分类 ─────────────────────────────────────────────────
const GLOBAL_TYPES = new Set([
  "server.connected",
  "global.disposed",
  "server.instance.disposed",
])
// 高频保活/噪音事件:只记最后心跳时间,不入 ring、不打印
// (否则刷屏 + 占满缓冲 + 掩盖 why 规则1 的"发送后无 event"判断)
const IGNORE_TYPES = new Set(["server.heartbeat"])
const BLOCKING_TYPES = new Set(["permission.asked", "question.asked"])
const BLOCKING_RESOLVE_TYPES = new Set([
  "permission.replied",
  "question.replied",
  "question.rejected",
])
const COMPACT_SESSION_TYPES = new Set([
  "session.status",
  "message.updated",
  "message.part.updated",
  "message.part.removed",
  "message.removed",
])

// ── §5.2 profile → 来源/类型精确映射 ─────────────────────────
const PROFILE_EVENT_TYPES: Record<NonNullable<SnapshotOpts["profile"]>, Set<string>> = {
  "no-feedback": new Set([
    "session.status",
    "message.updated",
    "message.part.updated",
    "permission.asked",
    "question.asked",
  ]),
  "stuck": new Set([
    "permission.asked",
    "question.asked",
    "permission.replied",
    "question.replied",
    "question.rejected",
    "session.status",
  ]),
  "errors": new Set(["global.disposed", "server.instance.disposed"]),
  "blank": new Set(["session.status", "message.updated"]),
  "upload": new Set(),
}

const PROFILE_LOG_SOURCES: Record<
  NonNullable<SnapshotOpts["profile"]>,
  Set<LogEntry["source"]>
> = {
  "no-feedback": new Set(["console.error", "window.error", "unhandledrejection"]),
  "stuck": new Set(),
  "errors": new Set(["console.error", "console.warn", "window.error", "unhandledrejection"]),
  "blank": new Set(["window.error", "unhandledrejection"]),
  "upload": new Set(["console.error", "console.warn", "console.log", "window.error"]),
}

// no-feedback 需要包含 send 记录；其他 profile 仅含事件/日志
const PROFILE_INCLUDE_SENDS = new Set<NonNullable<SnapshotOpts["profile"]>>(["no-feedback"])

// ── 工具函数 ─────────────────────────────────────────────────

function sessionIDOf(ev: AnyEvent): string | undefined {
  const p = ev.properties ?? {}
  if (typeof p.sessionID === "string") return p.sessionID
  const info = p.info as { sessionID?: string } | undefined
  if (info?.sessionID) return info.sessionID
  const part = p.part as { sessionID?: string } | undefined
  if (part?.sessionID) return part.sessionID
  return undefined
}

function compactSummary(ev: AnyEvent): Record<string, unknown> {
  const p = ev.properties ?? {}
  switch (ev.type) {
    case "session.status":
      return { status: (p.status as { type?: string })?.type, sessionID: p.sessionID }
    case "message.updated": {
      const info = p.info as { role?: string; id?: string } | undefined
      return { role: info?.role, msgID: info?.id }
    }
    case "message.part.updated": {
      const part = p.part as {
        type?: string; tool?: string; id?: string
        messageID?: string; state?: { status?: string }
      } | undefined
      return {
        partType: part?.type, tool: part?.tool,
        partStatus: part?.state?.status, partID: part?.id, msgID: part?.messageID,
      }
    }
    case "message.part.removed":
      return { partID: p.partID as string, msgID: p.messageID as string }
    case "message.removed":
      return { msgID: p.messageID as string }
    default:
      return p
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return (
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0")
  )
}

function fmtDelta(ms: number): string {
  if (ms <= 0) return "+0ms"
  if (ms < 1000) return `+${ms}ms`
  return `+${(ms / 1000).toFixed(1)}s`
}

function parseDuration(spec: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(s|m)$/.exec(spec)
  if (!m) return undefined
  const n = parseFloat(m[1])
  return m[2] === "m" ? n * 60000 : n * 1000
}

function parseTimeSpec(spec: string, refNow: number): number | undefined {
  const dur = parseDuration(spec)
  if (dur !== undefined) return refNow - dur
  const abs = /^(\d{1,2}):(\d{2})$/.exec(spec)
  if (abs) {
    const d = new Date()
    d.setHours(parseInt(abs[1], 10), parseInt(abs[2], 10), 0, 0)
    return d.getTime()
  }
  return undefined
}

// ── §5.5 IndexedDB 持久化(跨 reload/重启;无 IDB 时优雅降级为纯内存)──
// per-origin,与工作目录无关;只存一条 key="current" 的 ring 快照。
const DB_NAME = "octo-insight-debug"
const DB_STORE = "ring"
const PERSIST_DEBOUNCE_MS = 2000

type PersistedRing = {
  events: EventEntry[]
  sends: SendRecord[]
  logs: LogEntry[]
  updatedAt: number
}

function openDebugDB(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined)
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

function loadPersisted(db: IDBDatabase): Promise<PersistedRing | undefined> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("current")
      req.onsuccess = () => resolve(req.result as PersistedRing | undefined)
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

function savePersisted(db: IDBDatabase, ring: PersistedRing): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, "readwrite")
      tx.objectStore(DB_STORE).put(ring, "current")
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch { resolve() }
  })
}

// ── 主函数 ───────────────────────────────────────────────────

export function installInsightDebug(deps: DebugDeps): InsightDebug {
  let mode: DebugMode = "compact"
  const eventRing: EventEntry[] = []
  const sendRing: SendRecord[] = []
  const logRing: LogEntry[] = []
  let lastHeartbeatAt = 0 // 最后一次 server.heartbeat 时间(供 why 规则1 区分 SSE 断 vs server 没启动)

  // ── §5.5 持久化:启动读回上次 ring,之后节流写回;无 IDB 时全程降级为纯内存 ──
  let db: IDBDatabase | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let restoredCount = 0 // 从持久化读回的条数(供 snapshot 标注"含 N 条重启前")
  const ringSnapshot = (): PersistedRing => ({
    events: eventRing.slice(-EVENT_RING_CAP),
    sends: sendRing.slice(-SEND_RING_CAP),
    logs: logRing.slice(-LOG_RING_CAP),
    updatedAt: Date.now(),
  })
  const schedulePersist = () => {
    if (!db || persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      if (db) void savePersisted(db, ringSnapshot())
    }, PERSIST_DEBOUNCE_MS)
  }
  const capFront = <T>(arr: T[], cap: number) => {
    if (arr.length > cap) arr.splice(0, arr.length - cap)
  }
  void (async () => {
    db = await openDebugDB()
    if (!db) return // 无 IDB:纯内存,功能不受影响
    const saved = await loadPersisted(db)
    if (!saved) return
    // 读回的是"上次结束时"的旧数据,unshift 到头部(ts 更早),再 cap 保留最近
    eventRing.unshift(...(saved.events ?? [])); capFront(eventRing, EVENT_RING_CAP)
    sendRing.unshift(...(saved.sends ?? [])); capFront(sendRing, SEND_RING_CAP)
    logRing.unshift(...(saved.logs ?? [])); capFront(logRing, LOG_RING_CAP)
    restoredCount = (saved.events?.length ?? 0) + (saved.sends?.length ?? 0) + (saved.logs?.length ?? 0)
  })()

  const pushEvent = (type: string, properties: Record<string, unknown>) => {
    eventRing.push({ ts: Date.now(), type, properties })
    if (eventRing.length > EVENT_RING_CAP) eventRing.shift()
    schedulePersist()
  }

  const pushLog = (entry: LogEntry) => {
    logRing.push(entry)
    if (logRing.length > LOG_RING_CAP) logRing.shift()
    schedulePersist()
  }

  // ── delta 聚合 ─────────────────────────────────────────────
  const deltaAgg = new Map<
    string,
    { count: number; chars: number; field: string; msgID: string }
  >()
  let deltaTimer: ReturnType<typeof setTimeout> | undefined
  const flushDeltas = () => {
    deltaTimer = undefined
    if (deltaAgg.size === 0) return
    const entries = Array.from(deltaAgg.entries()).map(([partID, a]) => ({
      partID, msgID: a.msgID, field: a.field, count: a.count, chars: a.chars,
    }))
    deltaAgg.clear()
    pushEvent("message.part.delta(agg)", { entries })
    if (mode !== "quiet") console.log(`${LOG} message.part.delta ×聚合`, entries)
  }
  const armDeltaFlush = () => {
    if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS)
  }

  // ── SSE event 处理 ─────────────────────────────────────────
  const handle = (ev: AnyEvent) => {
    // 高频保活事件:只记心跳时间,不入 ring/不打印(降噪 + 不掩盖 why 规则1)
    if (IGNORE_TYPES.has(ev.type)) { lastHeartbeatAt = Date.now(); return }
    const sid = sessionIDOf(ev)
    const isGlobal = sid === undefined || GLOBAL_TYPES.has(ev.type)
    if (!isGlobal && sid !== deps.currentSessionID()) return

    if (ev.type === "message.part.delta") {
      const p = ev.properties ?? {}
      const partID = String(p.partID ?? "")
      const cur = deltaAgg.get(partID) ?? {
        count: 0, chars: 0,
        field: String(p.field ?? ""),
        msgID: String(p.messageID ?? ""),
      }
      cur.count += 1
      cur.chars += typeof p.delta === "string" ? p.delta.length : 0
      deltaAgg.set(partID, cur)
      armDeltaFlush()
      if (mode === "verbose") {
        console.log(`${LOG} message.part.delta`, {
          partID, field: p.field,
          deltaLen: (p.delta as string)?.length,
        })
      }
      return
    }

    // §4.6.1: 全字段入 ring
    pushEvent(ev.type, ev.properties ?? {})
    if (mode === "quiet") return

    const shouldLog =
      isGlobal ||
      BLOCKING_TYPES.has(ev.type) ||
      BLOCKING_RESOLVE_TYPES.has(ev.type) ||
      COMPACT_SESSION_TYPES.has(ev.type) ||
      mode === "verbose"
    if (!shouldLog) return

    const display = mode === "verbose" ? (ev.properties ?? {}) : compactSummary(ev)
    if (BLOCKING_TYPES.has(ev.type)) {
      console.warn(`${LOG} ${ev.type} ⚠️ agent 在等用户响应,这一轮会停住直到回复/拒绝`, ev.properties)
    } else {
      console.log(`${LOG} ${ev.type}`, display)
    }
  }

  const unsub = deps.globalSDK.event.listen((e) => {
    try { handle(e.details as unknown as AnyEvent) } catch { /* 观测层永不影响主流程 */ }
  })

  // ── §4.6.2: 未捕获异常 ────────────────────────────────────
  const origOnError = window.onerror
  window.onerror = (message, source, lineno, colno, error) => {
    try {
      pushLog({
        ts: Date.now(),
        source: "window.error",
        args: [{ message, source, lineno, colno, error }],
      })
    } catch { /* noop */ }
    if (origOnError) return origOnError.call(window, message, source, lineno, colno, error) as boolean
    return false
  }

  const onUnhandledRejection = (e: PromiseRejectionEvent) => {
    try { pushLog({ ts: Date.now(), source: "unhandledrejection", args: [e.reason] }) } catch { /* noop */ }
  }
  window.addEventListener("unhandledrejection", onUnhandledRejection)

  // ── §4.6.3: console.error / console.warn 镜像 ─────────────
  // 保存原始方法；dispose 时还原
  const origConsoleError = console.error
  const origConsoleWarn = console.warn
  let _mirrorGuard = false  // 防止 pushLog 内部再次触发循环

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(console as unknown as { error: (...a: any[]) => void }).error = (...args: unknown[]) => {
    if (!_mirrorGuard) {
      _mirrorGuard = true
      try { pushLog({ ts: Date.now(), source: "console.error", args }) } catch { /* noop */ }
      _mirrorGuard = false
    }
    origConsoleError.apply(console, args)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(console as unknown as { warn: (...a: any[]) => void }).warn = (...args: unknown[]) => {
    if (!_mirrorGuard) {
      _mirrorGuard = true
      try { pushLog({ ts: Date.now(), source: "console.warn", args }) } catch { /* noop */ }
      _mirrorGuard = false
    }
    origConsoleWarn.apply(console, args)
  }

  // §4.6.3 增强:镜像 [octo:* 前缀的 console.log(白名单,排除 observer 自身的 [octo:event])。
  // 救活 upload profile + 让 snapshot 含所有埋点链路日志([octo:prompt]/[octo:upload]/[octo:task]…)。
  const origConsoleLog = console.log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(console as unknown as { log: (...a: any[]) => void }).log = (...args: unknown[]) => {
    const first = args[0]
    if (
      !_mirrorGuard &&
      typeof first === "string" &&
      first.startsWith("[octo:") &&
      !first.startsWith("[octo:event")
    ) {
      _mirrorGuard = true
      try { pushLog({ ts: Date.now(), source: "console.log", args }) } catch { /* noop */ }
      _mirrorGuard = false
    }
    origConsoleLog.apply(console, args)
  }

  // ── §5.3: why() 规则引擎 ──────────────────────────────────
  function computeWhy(): string[] {
    const sid = deps.currentSessionID()
    const results: string[] = []
    const now = Date.now()
    const lastSend = sendRing[sendRing.length - 1]

    // 规则1: 有 send 且其后无实质 event(heartbeat 不入 ring,故 ring 有 event=真有动静)
    if (lastSend) {
      const hasEventsAfter = eventRing.some((e) => e.ts >= lastSend.ts)
      if (!hasEventsAfter) {
        const sseAlive = lastHeartbeatAt >= lastSend.ts
        results.push(
          sseAlive
            ? "⚠️ 发送后无实质事件,但 SSE 心跳仍在 → server 未启动该轮(非连接断)"
            : "⚠️ 发送后无服务器事件且无心跳 → 疑似 SSE 断 → 查 log 里 [global-sdk]",
        )
      }
    }

    // 规则2: pending permission/question > 0
    if (sid) {
      const permCount = (deps.syncData.permission[sid] ?? []).length
      const qCount = (deps.syncData.question[sid] ?? []).length
      if (permCount + qCount > 0) {
        results.push(
          `⚠️ 卡在等用户 (permission:${permCount}, question:${qCount}) → octoDebug.pending()`,
        )
      }
    }

    // 规则3: 最近 send.modelResolved === false
    if (lastSend && !lastSend.modelResolved) {
      results.push("⚠️ 发送时模型未解析 → §2.3")
    }

    // 规则4: session.status busy 超 60s 且无新 message.part
    if (sid) {
      const statusEntries = eventRing.filter((e) => e.type === "session.status")
      const lastStatus = statusEntries[statusEntries.length - 1]
      if (lastStatus && (lastStatus.properties.status as { type?: string })?.type === "busy") {
        const busySince = lastStatus.ts
        const lastPartEntry = [...eventRing]
          .reverse()
          .find(
            (e) =>
              e.type === "message.part.updated" ||
              e.type === "message.part.delta(agg)",
          )
        if (now - busySince > 60000 && (!lastPartEntry || lastPartEntry.ts < busySince)) {
          results.push("⚠️ 疑似生成卡死:session.status busy 超 60s 且无新 message.part")
        }
      }
    }

    // 规则5: 在 session 但 message 条目缺失(疑未加载/白屏;[] 是正常空会话,不报)
    if (sid) {
      const msgs = deps.syncData.message[sid]
      if (msgs === undefined && (eventRing.length > 0 || sendRing.length > 0)) {
        results.push(
          "⚠️ 疑似白屏/未加载:有 sessionID 但无 message 条目(持续如此才可疑,[] 空会话属正常)→ §2.1 + snapshot({full:true})",
        )
      }
    }

    // 规则6: 有未捕获异常
    const hasUncaught = logRing.some(
      (e) => e.source === "window.error" || e.source === "unhandledrejection",
    )
    if (hasUncaught) {
      results.push("⚠️ 存在未捕获异常 → snapshot({profile:'errors'})")
    }

    return results
  }

  // ── §5.1/5.4: 参数化 snapshot + 紧凑文本输出 ──────────────
  function buildSnapshot(opts?: SnapshotOpts): string {
    const now = Date.now()
    const sid = deps.currentSessionID()
    const lastSend = sendRing[sendRing.length - 1]

    // 确定时间窗口
    let windowStart: number
    let windowEnd = now
    let windowDesc = "最近一次发送→现在"

    if (opts?.last) {
      const dur = parseDuration(opts.last)
      windowStart = dur !== undefined ? now - dur : (lastSend?.ts ?? now - 60000)
      windowDesc = `最近 ${opts.last}`
    } else if (opts?.since) {
      windowStart = parseTimeSpec(opts.since, now) ?? (lastSend?.ts ?? now - 60000)
      windowDesc = `since ${opts.since}`
      if (opts.until) {
        const u = parseTimeSpec(opts.until, now)
        if (u !== undefined) { windowEnd = u; windowDesc += ` until ${opts.until}` }
      }
    } else if (opts?.around) {
      const msgEntry = eventRing.find((e) => {
        const info = e.properties.info as { id?: string } | undefined
        const part = e.properties.part as { messageID?: string } | undefined
        return info?.id === opts.around || part?.messageID === opts.around
      })
      const anchorTs = msgEntry?.ts ?? now
      const halfWindow = opts.window
        ? (parseDuration(opts.window) ?? 15000) / 2
        : 15000
      windowStart = anchorTs - halfWindow
      windowEnd = anchorTs + halfWindow
      windowDesc = `around ${opts.around} ±${halfWindow / 1000}s`
    } else {
      // §4.5 默认智能窗：lastSend.ts → now
      windowStart = lastSend?.ts ?? now - 60000
    }

    // 按窗口过滤三个 ring
    let filteredEvents = eventRing.filter((e) => e.ts >= windowStart && e.ts <= windowEnd)
    let filteredLogs = logRing.filter((e) => e.ts >= windowStart && e.ts <= windowEnd)
    let filteredSends = sendRing.filter((e) => e.ts >= windowStart && e.ts <= windowEnd)

    // §5.2 profile 过滤
    if (opts?.profile) {
      const evTypes = PROFILE_EVENT_TYPES[opts.profile]
      const logSrcs = PROFILE_LOG_SOURCES[opts.profile]

      filteredEvents = evTypes.size > 0
        ? filteredEvents.filter((e) => evTypes.has(e.type))
        : []

      if (logSrcs.size > 0) {
        filteredLogs = filteredLogs.filter((l) => {
          if (!logSrcs.has(l.source)) return false
          // upload profile: 只取 [octo:upload] 前缀的日志(含 console.log 链路)
          if (opts.profile === "upload") {
            return String(l.args[0] ?? "").includes("[octo:upload]")
          }
          return true
        })
      } else {
        filteredLogs = []
      }

      if (!PROFILE_INCLUDE_SENDS.has(opts.profile)) {
        filteredSends = []
      }
    }

    // types 直接过滤
    if (opts?.types && opts.types.length > 0) {
      const typeSet = new Set(opts.types)
      filteredEvents = filteredEvents.filter((e) => typeSet.has(e.type))
      filteredLogs = filteredLogs.filter((e) => typeSet.has(e.source))
    }

    // events 条数上限（只对 event 截断）
    if (opts?.events && opts.events > 0 && filteredEvents.length > opts.events) {
      filteredEvents = filteredEvents.slice(-opts.events)
    }

    // ── 组装紧凑文本（§5.4）──────────────────────────────────
    const lines: string[] = []
    const status = sid ? (deps.syncData.session_status[sid]?.type ?? "idle") : "n/a"
    const totalEntries = filteredEvents.length + filteredLogs.length + filteredSends.length

    lines.push(
      `== snapshot @ ${fmtTime(now)} | session=${sid ?? "none"} status=${status} | 窗口=${windowDesc} | ${totalEntries} 条${restoredCount > 0 ? ` | 含${restoredCount}条重启前` : ""} ==`,
    )

    // why() 摘要置顶
    const whyResults = computeWhy()
    if (whyResults.length > 0) {
      for (const w of whyResults) lines.push(`why: ${w}`)
    } else {
      lines.push("why: (无明显异常信号)")
    }

    // 合并三个来源并按时间排序
    type TimedLine = { ts: number; label: string }
    const allLines: TimedLine[] = []

    for (const s of filteredSends) {
      const ep = s.endpoint.length > 22 ? `…${s.endpoint.slice(-22)}` : s.endpoint
      allLines.push({
        ts: s.ts,
        label:
          "send                           " +
          `msg=${s.messageID} modelResolved=${s.modelResolved} ` +
          `status@send=${s.statusAtSend} ep=${ep}`,
      })
    }

    for (const e of filteredEvents) {
      const summary = compactSummary({ type: e.type, properties: e.properties })
      const kvStr = Object.entries(summary)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")
      allLines.push({
        ts: e.ts,
        label: `${e.type.padEnd(31)} ${kvStr}`.trimEnd(),
      })
    }

    const sourceLabel: Record<LogEntry["source"], string> = {
      "console.error": "log.error",
      "console.warn": "log.warn",
      "console.log": "log",
      "window.error": "log.window_error",
      "unhandledrejection": "log.rejected",
    }
    for (const l of filteredLogs) {
      const preview = l.args
        .slice(0, 2)
        .map((a) => {
          if (typeof a === "string") return a.slice(0, 100)
          try { return JSON.stringify(a).slice(0, 100) } catch { return String(a) }
        })
        .join(" | ")
      allLines.push({
        ts: l.ts,
        label: `${sourceLabel[l.source].padEnd(31)} ${preview}`,
      })
    }

    allLines.sort((a, b) => a.ts - b.ts)

    for (const line of allLines) {
      lines.push(`${fmtTime(line.ts)} ${fmtDelta(line.ts - windowStart).padEnd(10)} ${line.label}`)
    }

    // send 之后完全没有 event 时加提示行（与 §5.4 样例对齐）
    if (filteredSends.length > 0 && filteredEvents.length === 0) {
      lines.push(`${"".padEnd(24)} (此后无 event)`)
    }

    if (!opts?.profile) {
      lines.push("可用 profile: no-feedback / stuck / errors / blank / upload")
    }

    // full: 附当前 session message/part dump
    if (opts?.full && sid) {
      const messages = (deps.syncData.message[sid] ?? []) as Message[]
      const parts: Record<string, Part[]> = {}
      for (const m of messages) parts[m.id] = (deps.syncData.part[m.id] ?? []) as Part[]
      lines.push("")
      lines.push(`-- full dump: session=${sid} --`)
      lines.push(JSON.stringify({ messages, parts }, null, 2))
    }

    return lines.join("\n")
  }

  // ── window.octoDebug API ────────────────────────────────────
  const dbg = {
    help() {
      console.log(
        [
          "octoDebug —— Insight 内网控制台调试。命令:",
          "  octoDebug.state()         当前 session 状态摘要",
          "  octoDebug.dump()          当前 session 完整 message+part 原始 JSON",
          "  octoDebug.events(n=50)    最近 n 条 SSE 事件(环形缓冲)",
          "  octoDebug.logs(n=50)      最近 n 条 console.error/warn + 未捕获异常",
          "  octoDebug.sends(n=10)     最近 n 次发送",
          "  octoDebug.lastSend()      上一次发送详情",
          "  octoDebug.pending()       当前未回复的 permission/question",
          "  octoDebug.why()           速诊:规则引擎给最可能方向 + 下一步",
          "  octoDebug.snapshot(opts?) 一键现场快照并复制到剪贴板;缺省=最近一次发送→现在",
          "    opts: { last:'30s'|'2m', since:'14:30', until:'14:32',",
          "           around:'msg_x', window:'30s',",
          "           profile:'no-feedback'|'stuck'|'errors'|'blank'|'upload',",
          "           types:['session.status',...], full:true, events:80 }",
          "  octoDebug.mode('quiet'|'compact'|'verbose')  切日志详尽度(默认 compact)",
          "  octoDebug.verbose(true|false)                verbose 开关",
        ].join("\n"),
      )
      return undefined
    },

    state() {
      const sid = deps.currentSessionID()
      if (!sid) return { sessionID: undefined, note: "当前在首页/无会话" }
      const msgs = deps.syncData.message[sid] ?? []
      return {
        sessionID: sid,
        status: deps.syncData.session_status[sid]?.type ?? "idle",
        messages: msgs.length,
        userMessages: (msgs as Message[]).filter((m) => m.role === "user").length,
        assistantMessages: (msgs as Message[]).filter((m) => m.role === "assistant").length,
        pendingPermissions: (deps.syncData.permission[sid] ?? []).length,
        pendingQuestions: (deps.syncData.question[sid] ?? []).length,
        mode,
      }
    },

    dump() {
      const sid = deps.currentSessionID()
      if (!sid) return { sessionID: undefined }
      const messages = (deps.syncData.message[sid] ?? []) as Message[]
      const parts: Record<string, Part[]> = {}
      for (const m of messages) parts[m.id] = (deps.syncData.part[m.id] ?? []) as Part[]
      const out = {
        sessionID: sid,
        status: deps.syncData.session_status[sid]?.type ?? "idle",
        messages,
        parts,
      }
      console.log(`${LOG} dump`, out)
      return out
    },

    events(n = 50) {
      const out = eventRing.slice(-n)
      console.log(`${LOG} events (最近 ${out.length}/${eventRing.length} 条)`, out)
      return out
    },

    logs(n = 50) {
      const out = logRing.slice(-n)
      console.log(`${LOG} logs (最近 ${out.length}/${logRing.length} 条)`, out)
      return out
    },

    sends(n = 10) {
      const out = sendRing.slice(-n)
      console.log(`${LOG} sends (最近 ${out.length}/${sendRing.length} 次)`, out)
      return out
    },

    lastSend() {
      const out = sendRing[sendRing.length - 1]
      console.log(`${LOG} lastSend`, out)
      return out
    },

    pending() {
      const sid = deps.currentSessionID()
      if (!sid) return { permissions: [], questions: [] }
      const out = {
        permissions: deps.syncData.permission[sid] ?? [],
        questions: deps.syncData.question[sid] ?? [],
      }
      console.log(`${LOG} pending`, out)
      return out
    },

    why() {
      const results = computeWhy()
      if (results.length === 0) {
        console.log(`${LOG} why: 无明显异常信号`)
        return []
      }
      console.log(`${LOG} why:\n${results.map((r) => `  ${r}`).join("\n")}`)
      return results
    },

    snapshot(opts?: SnapshotOpts) {
      const text = buildSnapshot(opts)
      const ok = () => console.log(`${LOG} snapshot 已复制到剪贴板(${text.length} 字符)`)
      const fail = (hint: string) => console.log(`${LOG} snapshot 已生成(${text.length} 字符),${hint} → 从返回值复制`)
      // 优先走 Electron 主进程剪贴板(不受 DevTools console 缺用户手势限制);否则退 navigator.clipboard
      const api = getDesktopApi()
      if (api?.writeClipboardText) {
        void api.writeClipboardText(text).then(ok, () => fail("复制失败"))
      } else {
        const copied = navigator.clipboard?.writeText?.(text)
        if (copied) void copied.then(ok, () => fail("剪贴板不可用"))
        else fail("剪贴板不可用")
      }
      console.log(text)
      return text
    },

    mode(m?: DebugMode) {
      if (m === undefined) return mode
      if (m !== "quiet" && m !== "compact" && m !== "verbose") {
        console.warn(`${LOG} mode 仅支持 'quiet' | 'compact' | 'verbose'`)
        return mode
      }
      mode = m
      console.log(`${LOG} mode → ${mode}`)
      return mode
    },

    verbose(on = true) {
      mode = on ? "verbose" : "compact"
      console.log(`${LOG} mode → ${mode}`)
      return mode
    },
  }

  // 挂全局；keyed 重挂时后来的覆盖，dispose 时清
  ;(window as unknown as { octoDebug?: typeof dbg }).octoDebug = dbg

  return {
    recordSend(rec: SendRecord) {
      sendRing.push(rec)
      if (sendRing.length > SEND_RING_CAP) sendRing.shift()
      schedulePersist()
    },

    dispose() {
      unsub()
      if (deltaTimer) clearTimeout(deltaTimer)
      // §5.5 flush:立即写一次最新 ring 再关连接(保住"重启前"最后一刻)
      if (persistTimer) clearTimeout(persistTimer)
      if (db) {
        const d = db
        void savePersisted(d, ringSnapshot()).finally(() => d.close())
        db = undefined
      }
      // 还原 window.onerror
      window.onerror = origOnError
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      // 还原 console
      // eslint-disable-next-line no-console
      ;(console as unknown as { error: typeof origConsoleError }).error = origConsoleError
      // eslint-disable-next-line no-console
      ;(console as unknown as { warn: typeof origConsoleWarn }).warn = origConsoleWarn
      // eslint-disable-next-line no-console
      ;(console as unknown as { log: typeof origConsoleLog }).log = origConsoleLog
      // 清全局
      const w = window as unknown as { octoDebug?: typeof dbg }
      if (w.octoDebug === dbg) delete w.octoDebug
    },
  }
}
