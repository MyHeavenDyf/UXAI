import { Log } from "@opencode-ai/core/util/log"
import type { ExpansionParseDiagnostics } from "./prompt-expansion"

const log = Log.create({ service: "studio.prompt-expansion" })

const reported = new WeakMap<object, Set<string>>()

export function recommendationLogIDs(input: unknown) {
  if (!input || typeof input !== "object") return {}
  const value = input as Record<string, unknown>
  return Object.fromEntries(["requestID", "sessionID", "guidePartID"].flatMap((field) => {
    const id = value[field]
    return typeof id === "string" && /^[\w-]{1,128}$/.test(id) ? [[field, id]] : []
  }))
}

// SDK errors may contain authorization headers, request bodies and response bodies.
// Keep diagnostic metadata, including the original cause, without serializing those payloads.
function diagnostic(error: unknown, depth = 0): Record<string, unknown> {
  if (!error || typeof error !== "object") return { name: typeof error }
  const value = error as Record<string, unknown>
  return {
    ...(typeof value.name === "string" && /^[\w.$-]{1,128}$/.test(value.name) ? { name: value.name } : {}),
    ...(typeof value.code === "string" && /^[\w-]{1,64}$/.test(value.code) ? { code: value.code } : {}),
    ...(typeof value.statusCode === "number" ? { statusCode: value.statusCode } : {}),
    ...(typeof value.isRetryable === "boolean" ? { isRetryable: value.isRetryable } : {}),
    ...(typeof value.finishReason === "string" && /^[\w-]{1,64}$/.test(value.finishReason)
      ? { finishReason: value.finishReason } : {}),
    ...(value.cause !== undefined && depth < 2 ? { cause: diagnostic(value.cause, depth + 1) } : {}),
  }
}

export function logRecommendationFailure(
  error: unknown,
  context: Record<string, string | number | boolean | undefined>,
) {
  if (error && typeof error === "object") {
    const key = JSON.stringify([context.requestID, context.sessionID])
    const requests = reported.get(error) ?? new Set<string>()
    if (requests.has(key)) return
    requests.add(key)
    reported.set(error, requests)
  }
  if (context.cancelled) {
    console.log("[studio.prompt-expansion] cancelled", { ...context, error: diagnostic(error) })
    return
  }
  console.warn("[studio.prompt-expansion] failed", { ...context, error: diagnostic(error) })
}


// Log only the model's completed text output, never SDK request/error payloads or reasoning.
export function logExpansionOutput(
  context: Record<string, string | number | boolean | undefined>,
  output: {
    attempt: 1 | 2
    outcome: "accepted" | "repairing" | "rejected"
    rawText: string
    elapsedMs: number
    result?: { expandedPrompt: string; tags: string[] }
    feedback?: string
    candidates?: string[]
    diagnostics?: ExpansionParseDiagnostics
  },
) {
  const entry = JSON.stringify({
    ...context,
    ...output,
    stage: "output",
    repair: output.attempt === 2,
    rawBytes: Buffer.byteLength(output.rawText),
    rawCodePoints: [...output.rawText].length,
    candidates: output.candidates?.map((text) => ({ text, codePoints: [...text].length })),
    logFile: Log.file() || undefined,
  })
  // Print the original text verbatim; keep parsed results and diagnostics in the file log.
  console.log("[studio.prompt-expansion] output", output.rawText)
  if (Log.file()) log.info("output", { entry })
}
