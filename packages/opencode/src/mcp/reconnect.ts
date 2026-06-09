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
const MAX_ERRORS_BEFORE_RECONNECT = 3

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
  // Layer 1: onerror 检测（弥补 SDK 不触发 onclose 的缺口）
  let consecutiveErrors = 0
  let hasTriggeredClose = false

  client.onerror = (error: Error) => {
    log.error("transport error", { name, error: error.message })

    if (isTerminalConnectionError(error.message)) {
      consecutiveErrors++
      log.info("terminal connection error", {
        name,
        consecutiveErrors,
        maxErrors: MAX_ERRORS_BEFORE_RECONNECT,
      })
      if (consecutiveErrors >= MAX_ERRORS_BEFORE_RECONNECT && !hasTriggeredClose) {
        hasTriggeredClose = true
        consecutiveErrors = 0
        log.info("max terminal errors reached - forcing close", { name })
        client.close().catch((e) => {
          log.error("error during force close", { name, error: String(e) })
        })
      }
    } else {
      consecutiveErrors = 0
    }
  }

  // Layer 2: onclose 触发重连
  client.onclose = () => {
    if (checkAndClearIntentional(name)) {
      log.info("connection closed intentionally - skipping reconnect", { name })
      return
    }
    log.info("connection closed unexpectedly - triggering reconnect", { name })
    delete s.clients[name]
    delete s.defs[name]
    bridge.promise(reconnectWithBackoff(name, ctx)).catch((err) => {
      log.error("reconnect promise rejected", { name, error: String(err) })
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

      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (intentionalDisconnects.has(name)) {
          log.info("reconnect cancelled - user disconnected", { name })
          return
        }

        const delay = backoffMs(attempt)
        let s = yield* ctx.state.get()
        s.status[name] = { status: "connecting" }
        log.info("reconnect attempt", {
          name,
          attempt,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          delayMs: delay,
        })

        yield* Effect.sleep(delay)

        if (intentionalDisconnects.has(name)) return

        const result = yield* ctx.createFn(name, mcp).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            const msg = error instanceof Error ? error.message : String(error)
            return Effect.succeed<CreateResult>({
              status: { status: "failed" as const, error: msg },
            })
          }),
        )

        if (!result.mcpClient || result.status.status !== "connected") {
          log.warn("reconnect attempt failed", { name, attempt })
          continue
        }

        // 成功 — 存储新 client
        s = yield* ctx.state.get()
        yield* ctx.storeClientFn(s, name, result.mcpClient, result.defs!, mcp.timeout)
        log.info("reconnect succeeded", { name, attempt, toolCount: result.defs!.length })
        yield* ctx.bus.publish(ctx.toolsChanged, { server: name }).pipe(Effect.ignore)
        return
      }

      // 全部失败
      const s = yield* ctx.state.get()
      s.status[name] = {
        status: "failed",
        error: `Reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts`,
      }
      log.error("reconnect failed - max attempts reached", { name })
      yield* ctx.bus.publish(ctx.toolsChanged, { server: name }).pipe(Effect.ignore)
    } finally {
      activeReconnects.delete(name)
    }
  })
}