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

// === 状态跟踪（全部模块级，按 server name 隔离） ===

/** 主动断开标记（用户 disconnect / storeClient 替换等） */
const intentionalDisconnects = new Set<string>()
/** 正在跑的重连任务（防重入） */
const activeReconnects = new Set<string>()
/** remote 配置缓存（重连时复用） */
const remoteConfigs = new Map<string, ConfigMCP.Info & { type: "remote" }>()
/** 终端错误计数（每个 server name 一份，所有 handler 共享） */
const terminalErrorCounts = new Map<string, number>()
/** 已触发重连的标志（防止 onerror / onclose 多次触发） */
const triggeredReconnectFlags = new Set<string>()
/** handler 安装时间戳（用于 aliveMs 计算） */
const handlerInstalledAt = new Map<string, number>()

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

/** SDK 放弃重连信号（StreamableHTTPClientTransport._scheduleReconnection 末尾抛出） */
function isSdkGiveUpSignal(msg: string): boolean {
  return /Maximum reconnection attempts.*exceeded/.test(msg)
}

function backoffMs(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS)
}

function clientAgeMs(name: string): number | undefined {
  const at = handlerInstalledAt.get(name)
  return at ? Date.now() - at : undefined
}

// === 外部 API ===

/** 标记即将主动断开（不触发重连） */
export function markIntentionalDisconnect(name: string) {
  intentionalDisconnects.add(name)
  log.info("[reconnect] mark intentional disconnect", { name })
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
  const cleared = {
    intentional: intentionalDisconnects.size,
    active: activeReconnects.size,
    configs: remoteConfigs.size,
    counters: terminalErrorCounts.size,
    flags: triggeredReconnectFlags.size,
    handlers: handlerInstalledAt.size,
  }
  intentionalDisconnects.clear()
  activeReconnects.clear()
  remoteConfigs.clear()
  terminalErrorCounts.clear()
  triggeredReconnectFlags.clear()
  handlerInstalledAt.clear()
  log.info("[reconnect] module state cleaned up", cleared)
}

// === 主动健康检查（方案 D2：tools() 调用前 preflight ping） ===

const PREFLIGHT_PING_TIMEOUT_MS = 3000

/**
 * 在 tools() 调用前对所有 remote client 做 ping 健康检查。
 * ping 失败（含超时）立即触发重连。
 *
 * 设计原因：静默 TCP 丢包时 SDK 不会触发 onerror/onclose，只能通过主动 ping 探测。
 * 触发时机选 tools() 是因为：
 *  - 正好在 agent 实际用工具之前
 *  - 用户感知最低（每次对话开始时）
 *  - 不需要定时器（按需触发）
 */
export function verifyAndReconnectIfNeeded(
  bridge: EffectBridge.Shape,
  ctx: ReconnectContext,
  timeoutMs: number = PREFLIGHT_PING_TIMEOUT_MS,
) {
  return Effect.gen(function* () {
    const s = yield* ctx.state.get()
    const remoteNames = Object.keys(s.clients).filter((n) => remoteConfigs.has(n))

    if (remoteNames.length === 0) return

    log.debug("[reconnect] preflight starting", {
      serverCount: remoteNames.length,
      names: remoteNames,
    })

    yield* Effect.forEach(
      remoteNames,
      (name) =>
        Effect.gen(function* () {
          // 跳过：已触发过重连 / 正在重连 / 主动断开
          if (triggeredReconnectFlags.has(name) || activeReconnects.has(name)) {
            log.debug("[reconnect] preflight skipped - already in progress", { name })
            return
          }
          if (intentionalDisconnects.has(name)) {
            log.debug("[reconnect] preflight skipped - intentional disconnect", { name })
            return
          }

          const client = s.clients[name]
          if (!client) return

          // 用 Promise 内部 catch 把失败转成 boolean，避免 Effect 错误通道类型复杂化
          let pingOk = false
          let pingErr: unknown
          yield* Effect.tryPromise({
            try: () =>
              withClientTimeout(client.ping(), timeoutMs).then(
                () => {
                  pingOk = true
                },
                (e) => {
                  pingErr = e
                },
              ),
            catch: (e) => {
              pingErr = e
              return e instanceof Error ? e : new Error(String(e))
            },
          })

          if (pingOk) {
            log.debug("[reconnect] preflight ping ok", { name })
          } else {
            const errObj = pingErr
            const msg = errObj instanceof Error ? errObj.message : String(errObj)
            log.warn("[reconnect] preflight ping failed - triggering reconnect", {
              name,
              error: msg,
              timeoutMs,
            })
            triggerReconnect(s, name, client, bridge, ctx, "tools-preflight", `ping failed: ${msg}`)
          }
        }),
      { concurrency: "unbounded", discard: true },
    )

    log.debug("[reconnect] preflight completed", { serverCount: remoteNames.length })
  }).pipe(
    // 兜底：preflight 永远不应让 tools() 失败 — 任何异常都吞为日志
    Effect.catch((error) => {
      log.warn("[reconnect] preflight aborted with error", { error: String(error) })
      return Effect.void
    }),
  )
}

// === 工具调用失败兜底（方案 B：execute 内 catch 触发重连） ===

/**
 * 工具调用失败时触发重连。
 * 设计为 Effect 形式，由调用方通过 bridge.promise 启动（fire-and-forget）。
 *
 * 注意：本函数内部会从 ctx.state 获取最新 client，不依赖调用方传入的 client，
 * 这样即便 client 已被 storeClient 替换也能正确判断 stale。
 */
export function triggerReconnectFromToolFailure(
  name: string,
  bridge: EffectBridge.Shape,
  ctx: ReconnectContext,
  error: unknown,
  toolName?: string,
) {
  return Effect.gen(function* () {
    const s = yield* ctx.state.get()
    const client = s.clients[name]
    if (!client) {
      log.info("[reconnect] tool-failure trigger skipped - no client in state", {
        name,
        toolName,
        error: String(error),
      })
      return
    }
    const msg = error instanceof Error ? error.message : String(error)
    triggerReconnect(
      s,
      name,
      client,
      bridge,
      ctx,
      "tool-execute",
      `tool "${toolName ?? "<unknown>"}" call failed: ${msg}`,
    )
  }).pipe(
    // 兜底：tool-failure 永远不应让上层调用失败
    Effect.catch((e) => {
      log.warn("[reconnect] tool-failure trigger aborted", {
        name,
        toolName,
        error: String(e),
      })
      return Effect.void
    }),
  )
}

// === 辅助：Promise 超时包装（不依赖 Effect 的 withTimeout，保持纯 JS） ===

function withClientTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ping timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
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

/** 触发来源（用于日志和兜底分析） */
export type TriggerSource =
  | "onerror-giveup"
  | "onerror-counter"
  | "onclose-fallback"
  | "tools-preflight"
  | "tool-execute"

// === 触发重连（统一入口，绕过 onclose 死链） ===

/**
 * 直接触发重连，不依赖 client.close() → onclose 链路。
 * 幂等：triggeredReconnectFlags 防止 onerror / onclose / preflight / tool-execute 多次触发。
 *
 * 设计原因：SDK StreamableHTTPClientTransport 在某些场景下：
 *  - 重连失败后只调 onerror 不调 onclose（give-up signal）
 *  - 多 SSE stream 共享 _reconnectionTimeout 导致 close 后仍有延迟回调
 *  - transport 内部状态可能导致 close() 不触发 onclose
 *  - 静默 TCP 丢包时 onerror/onclose 都不触发（依赖上层 ping 兜底）
 * 因此把重连触发从 onclose 改为多处直调，绕过 SDK 的不确定性。
 */
function triggerReconnect(
  s: InternalState,
  name: string,
  client: Client,
  bridge: EffectBridge.Shape,
  ctx: ReconnectContext,
  source: TriggerSource,
  reason: string,
): void {
  // 幂等检查：同一 server 的重连只触发一次
  if (triggeredReconnectFlags.has(name)) {
    log.info("[reconnect] trigger suppressed - already triggered", {
      name,
      source,
      reason,
    })
    return
  }

  // 主动断开检查
  if (intentionalDisconnects.has(name)) {
    log.info("[reconnect] trigger suppressed - intentional disconnect", {
      name,
      source,
      reason,
    })
    return
  }

  // stale client 检查：state 中的 client 已经被替换（storeClient / connect 等场景）
  const currentClient = s.clients[name]
  if (currentClient !== client) {
    log.info("[reconnect] trigger suppressed - stale handler", {
      name,
      source,
      reason,
      hasCurrentClient: !!currentClient,
      clientAgeMs: clientAgeMs(name),
    })
    return
  }

  triggeredReconnectFlags.add(name)
  terminalErrorCounts.set(name, 0)

  log.warn("[reconnect] trigger fired - starting reconnect loop", {
    name,
    source,
    reason,
    consecutiveErrors: terminalErrorCounts.get(name) ?? 0,
    currentStatus: s.status[name]?.status,
    clientAgeMs: clientAgeMs(name),
    toolCount: s.defs[name]?.length ?? 0,
  })

  // 异步清理旧 client（不依赖其 onclose 触发）
  // 用 .catch 兜底，避免 close 抛错影响重连流程
  try {
    client.close().catch((e) => {
      log.debug("[reconnect] old client close error (safe to ignore)", {
        name,
        error: String(e),
      })
    })
  } catch (e) {
    log.debug("[reconnect] old client close threw synchronously (safe to ignore)", {
      name,
      error: String(e),
    })
  }

  // 启动重连（fire-and-forget）
  bridge.promise(reconnectWithBackoff(name, ctx)).catch((err) => {
    log.error("[reconnect] reconnect promise rejected", {
      name,
      error: String(err),
    })
  })
}

// === handler 设置 ===

export function setupConnectionHandlers(
  s: InternalState,
  name: string,
  client: Client,
  bridge: EffectBridge.Shape,
  ctx: ReconnectContext,
) {
  const installedAt = Date.now()
  const previousAge = handlerInstalledAt.has(name) ? Date.now() - (handlerInstalledAt.get(name) ?? 0) : undefined

  // 装新 handler 前清理该 server 的模块级状态（避免标志残留导致新 client 永远不触发重连）
  terminalErrorCounts.delete(name)
  triggeredReconnectFlags.delete(name)
  handlerInstalledAt.set(name, installedAt)

  log.info("[reconnect] connection handlers installed", {
    name,
    at: installedAt,
    previousHandlerAgeMs: previousAge,
    hadPreviousHandler: handlerInstalledAt.has(name),
    hasActiveReconnect: activeReconnects.has(name),
  })

  // Layer 1: onerror 检测 + 直接触发重连
  // 设计要点：
  //  - consecutiveErrors 使用模块级 Map（SDK 多 SSE stream 共享计数）
  //  - 满足触发条件后直接调用 triggerReconnect，不依赖 close()→onclose
  //  - 非终端错误不清零（避免 SDK 重连过程中的非终端错误振荡计数）
  client.onerror = (error: Error) => {
    const msg = error?.message ?? String(error)
    const isGiveUp = isSdkGiveUpSignal(msg)
    const isTerminal = isTerminalConnectionError(msg)
    const currentCount = terminalErrorCounts.get(name) ?? 0

    log.error("[reconnect] transport error", {
      name,
      error: msg,
      isTerminal,
      isGiveUp,
      consecutiveErrors: currentCount,
      clientAgeMs: clientAgeMs(name),
      currentStatus: s.status[name]?.status,
    })

    // 优先级 1：SDK give-up 信号 — 一次即触发（不计数）
    // SDK 放弃重连后只调 onerror 不调 onclose，transport 处于"僵死"状态
    if (isGiveUp) {
      log.warn("[reconnect] SDK gave up reconnecting", {
        name,
        error: msg,
        consecutiveErrors: currentCount,
      })
      triggerReconnect(s, name, client, bridge, ctx, "onerror-giveup", `SDK give-up: ${msg}`)
      return
    }

    // 优先级 2：终端错误累积到阈值 — 直接触发
    if (isTerminal) {
      const newCount = currentCount + 1
      terminalErrorCounts.set(name, newCount)
      log.info("[reconnect] terminal connection error counted", {
        name,
        consecutiveErrors: newCount,
        maxErrors: MAX_ERRORS_BEFORE_RECONNECT,
        error: msg,
      })
      if (newCount >= MAX_ERRORS_BEFORE_RECONNECT) {
        triggerReconnect(
          s,
          name,
          client,
          bridge,
          ctx,
          "onerror-counter",
          `terminal errors reached threshold (${newCount}/${MAX_ERRORS_BEFORE_RECONNECT}): ${msg}`,
        )
      }
      return
    }

    // 非终端错误：不清零（保留累积值），SDK 内部重连过程中可能反复抛 fetch failed 等非终端错误
    log.debug("[reconnect] non-terminal error ignored", {
      name,
      error: msg,
      consecutiveErrors: currentCount,
    })
  }

  // Layer 2: onclose 仅作可观测性日志（不再触发重连）
  // 重连触发已经移到 onerror 直接调用，onclose 仅用于排查 SDK 是否真的调用了 onclose
  client.onclose = () => {
    const aliveMs = Date.now() - installedAt
    const isIntentional = checkAndClearIntentional(name)
    const isStale = s.clients[name] !== client

    log.info("[reconnect] onclose fired (observability only)", {
      name,
      aliveMs,
      isIntentional,
      isStale,
      hasActiveReconnect: activeReconnects.has(name),
      alreadyTriggered: triggeredReconnectFlags.has(name),
      currentStatus: s.status[name]?.status,
    })

    // 兜底：如果 onerror 因任何原因没触发（如 SDK 直接 close 而不抛 onerror），
    // 并且不是主动断开、不是 stale、还没有触发过重连 — 用 onclose 作为最后兜底
    if (!isIntentional && !isStale && !triggeredReconnectFlags.has(name) && !activeReconnects.has(name)) {
      log.warn("[reconnect] onclose fallback triggered (onerror missed?)", {
        name,
        aliveMs,
      })
      triggerReconnect(s, name, client, bridge, ctx, "onclose-fallback", "onclose fired without preceding onerror")
    }
  }
}

// === 重连核心逻辑 ===

function reconnectWithBackoff(name: string, ctx: ReconnectContext): Effect.Effect<void> {
  return Effect.gen(function* () {
    // 防重入
    if (activeReconnects.has(name)) {
      log.info("[reconnect] reconnect loop skipped - already active", { name })
      return
    }
    activeReconnects.add(name)

    const reconnectStartAt = Date.now()
    let lastError: string | undefined

    try {
      const mcp = remoteConfigs.get(name)
      if (!mcp) {
        log.warn("[reconnect] no remote config - cannot reconnect", { name })
        return
      }

      log.info("[reconnect] starting reconnect loop", {
        name,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        clientAgeMs: clientAgeMs(name),
        url: mcp.url,
      })

      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        // 用户主动断开检查
        if (intentionalDisconnects.has(name)) {
          log.info("[reconnect] cancelled - user disconnected", {
            name,
            attempt,
            elapsedMs: Date.now() - reconnectStartAt,
          })
          return
        }

        const attemptStartAt = Date.now()
        log.info("[reconnect] attempt starting", {
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

        // 成功分支
        if (result.mcpClient && result.status.status === "connected") {
          // storeClient 内部会重新装 handler、清理状态
          const s = yield* ctx.state.get()
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

        // 失败分支
        lastError = (result.status as any).error
        log.warn("[reconnect] attempt failed", {
          name,
          attempt,
          durationMs: attemptDurationMs,
          status: result.status.status,
          error: lastError,
        })

        // 最后一次不再等待
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
          const delay = backoffMs(attempt)
          log.info("[reconnect] backoff", {
            name,
            nextAttempt: attempt + 1,
            delayMs: delay,
          })
          yield* Effect.sleep(delay)

          if (intentionalDisconnects.has(name)) {
            log.info("[reconnect] cancelled during backoff", {
              name,
              attempt,
              elapsedMs: Date.now() - reconnectStartAt,
            })
            return
          }
        }
      }

      // 全部失败：标记 status=failed，前端下次拉取/收到事件后感知
      const s = yield* ctx.state.get()
      delete s.clients[name]
      delete s.defs[name]
      s.status[name] = {
        status: "failed",
        error: `Reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts: ${lastError ?? "unknown"}`,
      }
      log.error("[reconnect] failed - max attempts reached", {
        name,
        totalDurationMs: Date.now() - reconnectStartAt,
        lastError,
      })
      yield* ctx.bus.publish(ctx.toolsChanged, { server: name }).pipe(Effect.ignore)
    } finally {
      activeReconnects.delete(name)
      log.info("[reconnect] loop ended", {
        name,
        totalDurationMs: Date.now() - reconnectStartAt,
        outcome: lastError ? "all-failed" : "completed",
      })
    }
  })
}
