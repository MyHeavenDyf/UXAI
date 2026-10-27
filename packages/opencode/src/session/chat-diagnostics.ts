import { randomUUID } from "node:crypto"

type Metadata = {
  sessionID?: string
  messageID?: string
  userMessageID?: string
  providerID?: string
  modelID?: string
  agent?: string
  layer: "prompt" | "llm" | "transport" | "processor"
  small?: boolean
}
type Fields = Record<string, string | number | boolean | null | undefined | string[] | number[]>

export function chatLog(metadata: Metadata, stage: string, fields: Fields = {}) {
  try {
    console.info("[octo:chat]", JSON.stringify({ diagnosticVersion: 1, ...metadata, stage, ...fields }))
  } catch {
    // Observability must never prevent a user request from running.
  }
}

/** Classify errors without writing message, stack, body, headers or tool input. */
export function chatError(error: unknown): Fields {
  const names: string[] = []
  const codes: string[] = []
  const statuses: number[] = []
  const categories = new Set<string>()
  const seen = new Set<object>()
  const pending: unknown[] = [error]
  try {
    for (let index = 0; index < 12 && pending.length; index++) {
      const value = pending.shift()
      if (!value || typeof value !== "object" || seen.has(value)) continue
      seen.add(value)
      const item = value as Record<string, unknown>
      if (typeof item.name === "string" && /^[\w.-]{1,100}$/.test(item.name)) names.push(item.name)
      if (typeof item.code === "string" && /^(?:E[A-Z0-9_]+|UND_ERR_[A-Z_]+)$/.test(item.code)) codes.push(item.code)
      const status = item.statusCode ?? item.status
      if (typeof status === "number" && status >= 100 && status <= 599) statuses.push(status)
      // Inspect only for a classification. Never print the actual error text.
      const text = `${typeof item.name === "string" ? item.name : ""} ${typeof item.message === "string" ? item.message.slice(0, 4096) : ""}`
      if (
        /unlogin|unauthori[sz]ed|forbidden|invalid.api.key|authentication/i.test(text) ||
        status === 401 ||
        status === 403
      )
        categories.add("authentication")
      if (/timeout|timed.out/i.test(text)) categories.add("timeout")
      if (/abort|cancel/i.test(text)) categories.add("aborted")
      if (/fetch failed|network|econn|enotfound|certificate|tls/i.test(text)) categories.add("network")
      if (/model.*not.*found|no.*such.*model/i.test(text)) categories.add("model-not-found")
      if (/parse|validation|invalid.*response|no.*output|no.*content/i.test(text))
        categories.add("invalid-or-empty-response")
      if (item.cause) pending.push(item.cause)
      if (item.error) pending.push(item.error)
    }
  } catch {
    categories.add("inspection-failed")
  }
  return { errorNames: names, errorCodes: codes, httpStatuses: statuses, categories: [...categories] }
}

export function createChatTrace(metadata: Metadata, heartbeatMs = 30_000) {
  const started = Date.now()
  const requestID = randomUUID()
  const state = {
    phase: "start",
    lastActivity: started,
    done: false,
    failed: false,
    events: 0,
    chunks: 0,
    bytes: 0,
    textChars: 0,
    reasoningChars: 0,
    toolCalls: 0,
    finishSeen: false,
  }
  const emit = (stage: string, fields: Fields = {}) =>
    chatLog(metadata, stage, {
      requestID,
      elapsedMs: Date.now() - started,
      ...fields,
    })
  const mark = (stage: string, fields: Fields = {}) => {
    if (state.done) return
    state.phase = stage
    state.lastActivity = Date.now()
    emit(stage, fields)
  }
  const heartbeat = setInterval(() => {
    if (state.done) return
    emit("waiting-or-progress", {
      waitingAt: state.phase,
      idleMs: Date.now() - state.lastActivity,
      events: state.events,
      chunks: state.chunks,
      bytes: state.bytes,
      textChars: state.textChars,
      reasoningChars: state.reasoningChars,
      toolCalls: state.toolCalls,
    })
  }, heartbeatMs)
  heartbeat.unref?.()
  emit("start")
  return {
    mark,
    event(event: { type: string; text?: string; finishReason?: unknown; error?: unknown }) {
      if (state.done) return
      state.events++
      state.lastActivity = Date.now()
      if (state.events === 1) mark("stream:first-event", { eventType: event.type })
      if (event.type === "text-delta") {
        if (!state.textChars) mark("stream:first-text")
        state.textChars += event.text?.length ?? 0
      }
      if (event.type === "reasoning-delta") {
        if (!state.reasoningChars) mark("stream:first-reasoning")
        state.reasoningChars += event.text?.length ?? 0
      }
      if (event.type === "tool-call") {
        state.toolCalls++
        mark("stream:tool-call", { toolCalls: state.toolCalls })
      }
      if (event.type === "tool-result" || event.type === "tool-error") mark(`stream:${event.type}`)
      if (event.type === "finish-step" || event.type === "finish") {
        state.finishSeen = event.type === "finish" || state.finishSeen
        mark(`stream:${event.type}`, {
          finishReason: ["stop", "length", "content-filter", "tool-calls", "error", "unknown", "other"].includes(
            String(event.finishReason),
          )
            ? String(event.finishReason)
            : "unrecognized",
        })
      }
      if (event.type === "error") {
        state.failed = true
        mark("stream:error", chatError(event.error))
      }
    },
    chunk(size: number) {
      if (state.done) return
      state.chunks++
      state.bytes += size
      state.lastActivity = Date.now()
      if (state.chunks === 1) mark("http:first-byte", { size })
    },
    error(error: unknown, stage = "failed") {
      if (state.done) return
      state.failed = true
      mark(stage, chatError(error))
    },
    finish(outcome?: string) {
      if (state.done) return
      state.done = true
      clearInterval(heartbeat)
      emit("end", {
        outcome:
          outcome ??
          (state.failed
            ? "failed"
            : metadata.layer !== "llm"
              ? "completed"
              : state.textChars
                ? "text-received"
                : state.toolCalls
                  ? "tool-only"
                  : state.reasoningChars
                    ? "reasoning-only"
                    : "empty-output"),
        lastStage: state.phase,
        events: state.events,
        chunks: state.chunks,
        bytes: state.bytes,
        textChars: state.textChars,
        reasoningChars: state.reasoningChars,
        toolCalls: state.toolCalls,
        finishSeen: state.finishSeen,
      })
    },
  }
}

export function chatTransportMetadata(input: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  return {
    sessionID: headers.get("x-session-affinity") ?? headers.get("x-opencode-session") ?? undefined,
    origin: url.origin,
    operation: ["/chat/completions", "/responses", "/messages"].find((path) => url.pathname.endsWith(path)) ?? "custom",
    method: init?.method ?? (input instanceof Request ? input.method : "GET"),
    authHeaders: ["authorization", "uiplustoken", "x-auth-token", "api-key", "x-api-key", "cookie"].filter((key) =>
      headers.has(key),
    ),
  }
}

export * as ChatDiagnostics from "./chat-diagnostics"
