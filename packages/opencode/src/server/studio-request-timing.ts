import { randomUUID } from "node:crypto"
import type { EventEmitter } from "node:events"
import type { IncomingMessage, ServerResponse } from "node:http"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "studio.request-timing" })
const requests = new WeakMap<object, StudioRequestTiming>()
const nativeRequests = new WeakMap<
  object,
  {
    started: number
    receivedAt: string
    priorLagMs: number
    id?: string
    responseReadyAt?: number
  }
>()

export type StudioRequestTiming = NonNullable<ReturnType<typeof startStudioRequestTiming>>

function selected(method: string, path: string) {
  return (
    (method === "POST" && path === "/studio/prompt-recommendations") ||
    (method === "GET" && (/^\/session\/[^/]+\/message$/.test(path) || path === "/global/health"))
  )
}

// Observe outside individual requests: a blocked process cannot start their timers.
export function observeStudioHttpServer(server: EventEmitter) {
  const state = { deadline: performance.now() + 100, samples: [] as { at: number; lag: number }[] }
  const recentLag = () =>
    Math.round(
      Math.max(
        0,
        performance.now() - state.deadline,
        ...state.samples.filter((sample) => performance.now() - sample.at <= 5_000).map((sample) => sample.lag),
      ),
    )
  const timer = setInterval(() => {
    const now = performance.now()
    state.samples = [
      ...state.samples.filter((sample) => now - sample.at <= 5_000),
      { at: now, lag: Math.max(0, now - state.deadline) },
    ].slice(-50)
    state.deadline = now + 100
  }, 100)
  timer.unref()
  const receive = (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname
    if (!selected(request.method ?? "", path)) return
    const native: NonNullable<ReturnType<typeof nativeRequests.get>> = {
      started: performance.now(),
      receivedAt: new Date().toISOString(),
      priorLagMs: recentLag(),
    }
    nativeRequests.set(request, native)
    const completed = { value: false }
    const complete = () => {
      if (completed.value) return
      completed.value = true
      const now = performance.now()
      log.info("transport", {
        entry: JSON.stringify({
          id: native.id,
          receivedAt: native.receivedAt,
          method: request.method,
          path,
          status: response.statusCode,
          finished: response.writableFinished,
          nativeTotalMs: Math.round(now - native.started),
          afterResponseReadyMs:
            native.responseReadyAt === undefined ? undefined : Math.round(now - native.responseReadyAt),
          priorEventLoopLagMs: native.priorLagMs,
          recentEventLoopLagMs: recentLag(),
        }),
      })
      nativeRequests.delete(request)
    }
    response.once("finish", complete)
    response.once("close", complete)
  }
  server.prependListener("request", receive)
  const stop = () => {
    clearInterval(timer)
    server.off("request", receive)
    server.off("close", stop)
    server.off("error", stop)
  }
  server.once("close", stop)
  server.once("error", stop)
  return { recentLag, stop }
}

// Diagnostic metadata only: never retain bodies, query strings, headers or directories.
export function startStudioRequestTiming(source: object, method: string, url: string) {
  const path = new URL(url, "http://localhost").pathname
  if (!selected(method, path)) return
  const native = nativeRequests.get(source)
  const started = native?.started ?? performance.now()
  const stages: { stage: string; elapsedMs: number; durationMs: number }[] = []
  const state = { previous: started, deadline: performance.now() + 100, maxLagMs: 0, finished: false }
  const id = randomUUID()
  const receivedAt = native?.receivedAt ?? new Date().toISOString()
  if (native) native.id = id
  const lag = () => {
    state.maxLagMs = Math.max(state.maxLagMs, performance.now() - state.deadline, 0)
  }
  const timer = setInterval(() => {
    lag()
    state.deadline = performance.now() + 100
  }, 100)
  timer.unref()
  const timing = {
    id,
    mark(stage: string) {
      const now = performance.now()
      stages.push({ stage, elapsedMs: Math.round(now - started), durationMs: Math.round(now - state.previous) })
      state.previous = now
    },
    headers() {
      lag()
      return {
        "X-Studio-Timing-Version": "2",
        "X-Studio-Timing-Id": id,
        "X-Studio-Received-At": receivedAt,
        "Server-Timing": [
          ...stages.map((item) => `${item.stage};dur=${item.durationMs}`),
          `event_loop_lag;dur=${Math.round(state.maxLagMs)}`,
          ...(native ? [`prior_event_loop_lag;dur=${native.priorLagMs}`] : []),
          `total;dur=${Math.round(performance.now() - started)}`,
        ].join(", "),
      }
    },
    finish(status: number) {
      if (state.finished) return
      state.finished = true
      lag()
      clearInterval(timer)
      if (native) native.responseReadyAt = performance.now()
      requests.delete(source)
      log.info("complete", {
        entry: JSON.stringify({
          id,
          receivedAt,
          method,
          path,
          status,
          elapsedMs: Math.round(performance.now() - started),
          maxEventLoopLagMs: Math.round(state.maxLagMs),
          priorEventLoopLagMs: native?.priorLagMs,
          stages,
        }),
      })
    },
  }
  requests.set(source, timing)
  if (native) timing.mark("http_middleware")
  return timing
}

export const studioRequestTiming = (source: object) => requests.get(source)
