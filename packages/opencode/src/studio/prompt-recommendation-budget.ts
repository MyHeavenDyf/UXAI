import { RecommendationError } from "./prompt-recommendation-schema"

export const PREPARATION_TIMEOUT_MS = 30_000

export function createPreparation(parent?: AbortSignal, timeout = PREPARATION_TIMEOUT_MS) {
  const controller = new AbortController()
  const expires = Date.now() + timeout
  const expire = () => controller.abort(new RecommendationError("PREPARATION_TIMEOUT", 503))
  const cancel = () => controller.abort(new RecommendationError("REQUEST_CANCELLED"))
  const timer = setTimeout(expire, timeout)
  parent?.addEventListener("abort", cancel, { once: true })
  if (parent?.aborted) cancel()
  return {
    signal: controller.signal,
    check() {
      if (!controller.signal.aborted && Date.now() >= expires) expire()
      controller.signal.throwIfAborted()
    },
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener("abort", cancel)
    },
  }
}
export type PreparationBudget = ReturnType<typeof createPreparation>

// Process-wide admission counters. Each acquired permit has exactly one owner.
const active = { request: 0, execution: 0 }
export function acquireBudget(kind: keyof typeof active) {
  if (active[kind] >= 4) throw new RecommendationError("CAPACITY_EXCEEDED", 429)
  active[kind]++
  let released = false
  return () => {
    if (released) return
    released = true
    active[kind]--
  }
}

export const MAX_BODY = 30 * 1024 * 1024
export async function readRecommendationBody(body: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    signal?.throwIfAborted()
    size += chunk.byteLength
    if (size > MAX_BODY) throw new RecommendationError("PAYLOAD_TOO_LARGE", 413)
    chunks.push(chunk)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  return parsed
}
