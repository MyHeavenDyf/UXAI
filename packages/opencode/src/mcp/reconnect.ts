import { Effect, Cause } from "effect"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import * as Log from "@opencode-ai/core/util/log"
import type { EffectBridge } from "@/effect/bridge"
import type { ConfigMCP } from "../config/mcp"

const log = Log.create({ service: "mcp.reconnect" })

// === 常量 ===
const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const MAX_ERRORS_BEFORE_RECONNECT = 2

// === 状态跟踪 ===
const intentionalDisconnects = new Set<string>()
const activeReconnects = new Set<string>()
const remoteConfigs = new Map<string, ConfigMCP.Info & { type: "remote" }>()

// === 辅助函数 ===

function isTerminalConnectionError(msg: string): boolean {
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("EPIPE") ||
    msg.includes("EHOSTUNREACH") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Body Timeout Error") ||
    msg.includes("terminated") ||
    msg.includes("SSE stream disconnected") ||
    msg.includes("Failed to reconnect SSE stream")
  )
}

// SDK 内部重连放弃信号（StreamableHTTPClientTransport._scheduleReconnection 末尾抛出）
// SDK 放弃重连后只触发 onerror，不触发 onclose → transport 处于"僵死"状态。
// 我们识别此信号后主动 client.close()，借由 transport.close() 显式调用 onclose 来启动 Layer 2。
function isSdkGiveUpSignal(msg: string): boolean {
  return /Maximum reconnection attempts.*exceeded/.test(msg)
}

function backoffMs(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS)
}

// === 外部 API ===

/** 标记即将主动断开（不触发重连） */
export function markIntentionalDisconnect(name: string) {
  intentionalDisconnects.add(name)
}

/** 检查是否主动断开并清除标记 */
export function checkAndClearIntentional(name: string): boolean {
  return intentionalDisconnects.delete(name)
}

/** 存储 remote 配置供重连使用 */
export function storeRemoteConfig(name: string, config: ConfigMCP.Info & { type: "remote" }) {
  remoteConfigs.set(name, config)
}

/** 检查是否存在 remote 配置 */
export function hasRemoteConfig(name: string): boolean {
  return remoteConfigs.has(name)
}

/** 清理所有重连状态（应用关闭时） */
export function cleanup() {
  intentionalDisconnects.clear()
  activeReconnects.clear()
  remoteConfigs.clear()
}

// === 类型定义（与 index.ts 内部类型对接） ===

/** 内部状态结构（与 index.ts State 对应） */
export interface InternalState {
  status: Record<string, any>
  clients: Record<string, Client>
  defs: Record<string, any[]>
}

/** 创建结果（与 index.ts CreateResult 对应） */
export interface CreateResult {
  mcpClient?: Client
  status: { status: string; error?: string }
  defs?: any[]
}

/** 重连上下文（注入 Layer 内部依赖） */
export interface ReconnectContext {
  state: { get: () => Effect.Effect<InternalState> }
  createFn: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<CreateResult>
  storeClientFn: (
    s: InternalState,
    name: string,
    client: Client,
    listed: any[],
    timeout?: number,
  ) => Effect.Effect<any>
  bus: { publish: (event: any, data: any) => Effect.Effect<any> }
  toolsChanged: any
}

// === 两层检测 handler 设置 ===

export function setupConnectionHandlers(
  s: InternalState,
  name: string,
  client: Client,
  bridge: EffectBridge.Shape,
  ctx: ReconnectContext,
) {
  const handlerInstalledAt = Date.now()
  log.info("[reconnect] connection handlers installed", { name, at: handlerInstalledAt })

  // Layer 1: onerror 检测（弥补 SDK 不触发 onclose 的缺口）
  let consecutiveErrors = 0
  let hasTriggeredClose = false

  client.onerror = (error: Error) => {
    const msg = error.message

    // 优先级 1：SDK 放弃重连信号 — 一次即触发 close。
    // SDK 在放弃重连后只调用 onerror，绝不调用 onclose，transport 进入"僵死"状态。
    // 我们主动 client.close() 让 transport.close() 显式触发 onclose → Layer 2 接管。
    if (isSdkGiveUpSignal(msg)) {
      log.warn("[reconnect] SDK gave up reconnecting - forcing close", {
        name,
        error: msg,
        consecutiveErrors,
      })
      if (!hasTriggeredClose) {
        hasTriggeredClose = true
        consecutiveErrors = 0
        client.close().catch((e) => {
          log.error("[reconnect] error during force close (give-up)", { name, error: String(e) })
        })
      }
      return
    }

    // 优先级 2：终端错误累积（兜底，应对 SDK 没抛 give-up 但 transport 实际僵死的场景）
    const isTerminal = isTerminalConnectionError(msg)
    log.error("[reconnect] transport error", {
      name,
      error: msg,
      isTerminal,
      isGiveUp: false,
      consecutiveErrors,
    })

    if (isTerminal) {
      consecutiveErrors++
      log.info("[reconnect] terminal connection error counted", {
        name,
        consecutiveErrors,
        maxErrors: MAX_ERRORS_BEFORE_RECONNECT,
      })
      if (consecutiveErrors >= MAX_ERRORS_BEFORE_RECONNECT && !hasTriggeredClose) {
        hasTriggeredClose = true
        consecutiveErrors = 0
        log.info("[reconnect] max terminal errors reached - forcing close to trigger reconnect", {
          name,
          threshold: MAX_ERRORS_BEFORE_RECONNECT,
        })
        client.close().catch((e) => {
          log.error("[reconnect] error during force close", { name, error: String(e) })
        })
      }
    }
    // 非终端错误不再清零 consecutiveErrors —— SDK 内部重连时会先抛 fetch failed（非终端）再抛
    // Failed to reconnect SSE stream（终端），夹在中间的清零会让计数永远振荡 0↔1。
  }

  // Layer 2: onclose 触发重连
  client.onclose = () => {
    const aliveMs = Date.now() - handlerInstalledAt
    log.info("[reconnect] onclose fired", { name, aliveMs })

    if (checkAndClearIntentional(name)) {
      log.info("[reconnect] connection closed intentionally - skipping reconnect", { name, aliveMs })
      return
    }
    // 过期检查：如果 state 中的 client 已被替换，说明这是旧 handler 延迟触发，跳过
    if (s.clients[name] !== client) {
      log.info("[reconnect] stale onclose handler - client already replaced, skip", { name, aliveMs })
      return
    }
    log.warn("[reconnect] connection closed unexpectedly - triggering auto reconnect", {
      name,
      aliveMs,
      triggeredByOnerror: hasTriggeredClose,
      currentStatus: s.status[name]?.status,
      toolCount: s.defs[name]?.length ?? 0,
    })
    // 不删除 s.clients[name] / s.defs[name] / s.status[name]，避免 tools() 阻塞或返回空。
    // 保留旧的 connected 状态与 defs 缓存：
    //  - tools() 不会因 "connecting" 状态触发 5s 等待循环
    //  - tools() 返回旧 tool 定义（client 已死，调用会在运行时失败，由上层 catch 处理）
    //  - 重连成功时 storeClient 会替换为新数据
    //  - 重连全部失败时再删除并置为 failed
    bridge.promise(reconnectWithBackoff(name, ctx)).catch((err) => {
      log.error("[reconnect] reconnect promise rejected", { name, error: String(err) })
    })
  }
}

// === 重连核心逻辑 ===

function reconnectWithBackoff(name: string, ctx: ReconnectContext): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (activeReconnects.has(name)) return
    activeReconnects.add(name)

    try {
      const mcp = remoteConfigs.get(name)
      if (!mcp) {
        log.warn("no remote config for reconnect", { name })
        return
      }

      const reconnectStartAt = Date.now()
      log.info("[reconnect] starting reconnect loop", {
        name,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })

      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (intentionalDisconnects.has(name)) {
          log.info("[reconnect] cancelled - user disconnected", { name, attempt })
          return
        }

        // 注意：不写 s.status[name] = "connecting"
        // 保持旧的 "connected" 状态，避免 tools() 触发 5s 等待循环。
        // 旧 defs 缓存仍可用（虽然 client 已死，调用会在运行时被 convertMcpTool 的 try/catch 兜住）。
        const attemptStartAt = Date.now()
        log.info("[reconnect] attempt", {
          name,
          attempt,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          elapsedSinceStartMs: attemptStartAt - reconnectStartAt,
        })

        const result = yield* ctx.createFn(name, mcp).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            const msg = error instanceof Error ? error.message : String(error)
            return Effect.succeed<CreateResult>({
              status: { status: "failed" as const, error: msg },
            })
          }),
        )

        const attemptDurationMs = Date.now() - attemptStartAt

        if (!result.mcpClient || result.status.status !== "connected") {
          log.warn("[reconnect] attempt failed", {
            name,
            attempt,
            durationMs: attemptDurationMs,
            status: result.status.status,
            error: (result.status as any).error,
          })
          // 最后一次失败不再等待
          if (attempt < MAX_RECONNECT_ATTEMPTS) {
            const delay = backoffMs(attempt)
            log.info("[reconnect] backoff", { name, nextAttempt: attempt + 1, delayMs: delay })
            yield* Effect.sleep(delay)
            if (intentionalDisconnects.has(name)) {
              log.info("[reconnect] cancelled during backoff - user disconnected", { name })
              return
            }
          }
          continue
        }

        // 成功 — 存储新 client（storeClient 会原子替换旧的死 client）
        let s = yield* ctx.state.get()
        yield* ctx.storeClientFn(s, name, result.mcpClient, result.defs!, mcp.timeout)
        log.info("[reconnect] succeeded", {
          name,
          attempt,
          attemptDurationMs,
          totalDurationMs: Date.now() - reconnectStartAt,
          toolCount: result.defs!.length,
        })
        yield* ctx.bus.publish(ctx.toolsChanged, { server: name }).pipe(Effect.ignore)
        return
      }

      // 全部失败 — 此时才删除 defs/clients 并置为 failed，前端下次拉取/收到事件后才能感知
      const s = yield* ctx.state.get()
      delete s.clients[name]
      delete s.defs[name]
      s.status[name] = {
        status: "failed",
        error: `Reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`,
      }
      log.error("[reconnect] failed - max attempts reached, marking server as failed", {
        name,
        totalDurationMs: Date.now() - reconnectStartAt,
      })
      yield* ctx.bus.publish(ctx.toolsChanged, { server: name }).pipe(Effect.ignore)
    } finally {
      activeReconnects.delete(name)
      log.info("[reconnect] loop ended, cleared active flag", { name })
    }
  })
}