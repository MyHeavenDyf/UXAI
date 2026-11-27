import { randomUUID } from "node:crypto"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "studio.request-timing" })
const requests = new WeakMap<object, StudioRequestTiming>()

export type StudioRequestTiming = NonNullable<ReturnType<typeof startStudioRequestTiming>>

// Diagnostic metadata only: never retain bodies, query strings, headers or directories.
export function startStudioRequestTiming(source: object, method: string, url: string) {
  const path = new URL(url, "http://localhost").pathname
  if (
    !(method === "POST" && path === "/studio/prompt-recommendations") &&
    !(method === "GET" && (/^\/session\/[^/]+\/message$/.test(path) || path === "/global/health"))
  )
    return
  const started = performance.now()
  const stages: { stage: string; elapsedMs: number; durationMs: number }[] = []
  const state = { previous: started, deadline: started + 100, maxLagMs: 0, finished: false }
  const id = randomUUID()
  const receivedAt = new Date().toISOString()
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
        "X-Studio-Timing-Id": id,
        "Server-Timing": [
          ...stages.map((item) => `${item.stage};dur=${item.durationMs}`),
          `event_loop_lag;dur=${Math.round(state.maxLagMs)}`,
          `total;dur=${Math.round(performance.now() - started)}`,
        ].join(", "),
      }
    },
    finish(status: number) {
      if (state.finished) return
      state.finished = true
      lag()
      clearInterval(timer)
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
          stages,
        }),
      })
    },
  }
  requests.set(source, timing)
  return timing
}

export const studioRequestTiming = (source: object) => requests.get(source)
