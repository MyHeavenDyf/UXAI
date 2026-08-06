const CHARS_PER_TOKEN = 4
const MEDIA_TOKEN_ESTIMATE = 1_024

export function estimate(input: string) {
  return estimateChars((input || "").length)
}

export function estimateChars(length: number) {
  return Math.max(0, Math.round(length / CHARS_PER_TOKEN))
}

export function estimateValue(input: unknown) {
  const seen = new WeakSet<object>()
  const visit = (value: unknown): number => {
    if (typeof value === "string") {
      if (value.startsWith("data:") && value.includes(";base64,")) return MEDIA_TOKEN_ESTIMATE
      return estimate(value)
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return estimate(String(value))
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return MEDIA_TOKEN_ESTIMATE
    if (Array.isArray(value)) return value.reduce((total, item) => total + visit(item), 0)
    if (!value || typeof value !== "object" || seen.has(value)) return 0
    seen.add(value)
    return Object.entries(value).reduce((total, [key, item]) => total + estimate(key) + visit(item), 0)
  }
  return visit(input)
}

export * as Token from "./token"
