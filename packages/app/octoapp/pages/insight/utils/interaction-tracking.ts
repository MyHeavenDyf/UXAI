import { tracker } from "@/utils/tracker"

type Fields = Record<string, string | number | boolean | undefined>
type Status = "success" | "partial" | "failure" | "cancelled"
type Operation = "files-delete" | "files-upload" | "md-save" | "archive" | "context-compact" | "permission-decision" | "question-response" | "addon-import"

export function trackInsight(name: string, fields: Fields = {}) {
  // Telemetry must never turn a completed user action into a failed action.
  try {
    tracker.interaction({ module: "insight", name, extend: JSON.stringify(fields) })
  } catch {
    // The existing frontend transport is best-effort; no business retry here.
  }
}

export function beginInsightOperation(
  name: Operation,
  fields: Fields = {},
  send: typeof trackInsight = trackInsight,
) {
  const startedAt = Date.now()
  const context = { ...fields, operationId: globalThis.crypto?.randomUUID?.() ?? `${startedAt}-${Math.random().toString(36).slice(2)}` }
  const emit = (phase: "start" | "result", data: Fields) => {
    try {
      send(`${name}-${phase}`, data)
    } catch {
      // Keep optional observers from changing business control flow.
    }
  }
  emit("start", context)
  let finished = false
  return (status: Status, result: Fields = {}) => {
    if (finished) return
    finished = true
    emit("result", { ...result, ...context, status, durationMs: Math.max(0, Date.now() - startedAt) })
  }
}

/** An empty directory can succeed; rejected files or partial copies cannot. */
export function uploadStatus(total: number, succeeded: number, rejected = 0): Status {
  if (rejected === 0 && succeeded === total) return "success"
  return succeeded > 0 ? "partial" : "failure"
}

// Keys stay in memory only: never send content, file paths or resource URLs.
export function createPreviewTracker(state: () => { key: unknown[]; fields: Fields }, send: typeof trackInsight = trackInsight) {
  let previous: unknown[] = []
  const reported = new Set<string>()
  return (evidence: string) => {
    const current = state()
    if (current.key.length !== previous.length || current.key.some((value, index) => value !== previous[index])) {
      previous = current.key
      reported.clear()
    }
    if (reported.has(evidence)) return
    reported.add(evidence)
    send("result-preview-ready", { ...current.fields, evidence })
  }
}
