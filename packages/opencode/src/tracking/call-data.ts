import { record, string, mcpFacts } from "./facts"
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js"

const secret = /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|credential|signature|^sig$)/i

export function cleanText(value: string) {
  return value
    .replace(/data:[^\s;,]+;base64,[a-z\d+/=]+/gi, "[binary omitted]")
    .replace(/\b(Bearer|Basic)\s+[a-z\d._~+/=-]+/gi, "$1 [redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(
      /([?&](?:[^\s=&]*(?:token|signature|credential|secret|key)|sig|auth)[^\s=&]*=)[^\s&#"']+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:["']?)(?:[\w-]*(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)[\w-]*)(?:["']?)\s*(?:=|:)\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .replace(/(--?(?:password|passwd|token|secret|api-key|authorization)\s+)("[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
}

// Persist only this bounded, filtered representation, never raw arguments/results.
export function capture(value: unknown, limit = 16 * 1024) {
  const redactedFields: string[] = []
  const omittedFields: string[] = []
  const seen = new WeakSet<object>()
  const budget = { left: limit - 256, truncated: false }
  const take = (value: unknown, field: string, depth: number): unknown => {
    if (budget.left < 64 || depth > 8) {
      budget.truncated = true
      if (omittedFields.length < 16) omittedFields.push(field.slice(0, 256))
      return "[omitted]"
    }
    if (typeof value === "string") {
      const cleaned = cleanText(value)
      if (cleaned !== value && redactedFields.length < 16) redactedFields.push(field.slice(0, 256))
      const max = Math.min(4096, budget.left - 32)
      const bytes = Buffer.from(cleaned)
      const result = bytes.length > max ? bytes.subarray(0, max - 20).toString("utf8") + "…[truncated]" : cleaned
      if (bytes.length > max) budget.truncated = true
      budget.left -= Buffer.byteLength(JSON.stringify(result))
      return result
    }
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      budget.left -= 16
      return value
    }
    if (typeof value !== "object") return String(value)
    if (seen.has(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      if (omittedFields.length < 16) omittedFields.push(field.slice(0, 256))
      return "[binary or circular omitted]"
    }
    seen.add(value)
    if (Array.isArray(value)) {
      const output: unknown[] = []
      for (const [index, item] of value.entries()) {
        if (index >= 64 || budget.left < 128) {
          budget.truncated = true
          break
        }
        output.push(take(item, `${field}[${index}]`, depth + 1))
      }
      return output
    }
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (budget.left < 128 || Object.keys(output).length >= 64) {
        budget.truncated = true
        break
      }
      const name = cleanText(key).slice(0, 128)
      budget.left -= Buffer.byteLength(JSON.stringify(name)) + 4
      if (secret.test(key)) {
        output[name] = "[redacted]"
        if (redactedFields.length < 16) redactedFields.push(`${field}.${name}`.slice(0, 256))
        continue
      }
      output[name] = take(item, `${field}.${name}`, depth + 1)
    }
    return output
  }
  const data = take(value, "$", 0)
  // Escaping (quotes/control characters) may expand UTF-8 beyond the traversal budget.
  const encoded = JSON.stringify(data)
  return {
    value: Buffer.byteLength(encoded ?? "") > limit ? "[payload exceeds limit]" : data,
    truncated: budget.truncated || Buffer.byteLength(encoded ?? "") > limit,
    redactedFields,
    omittedFields,
  }
}

export function failure(error: unknown, cancelled = false) {
  const info = record(error)
  const name = string(info._tag || info.name || (error instanceof Error ? error.name : undefined))
  const status = /Permission(?:Denied|Rejected|Corrected)Error/.test(name)
    ? "denied"
    : /Timeout/i.test(name) || info.code === "ETIMEDOUT" || info.code === ErrorCode.RequestTimeout
      ? "timeout"
      : cancelled || /AbortError|QuestionRejectedError/.test(name)
        ? "cancelled"
        : "failure"
  return {
    status,
    errorType: name || "Error",
    errorCode: string(info.code) || undefined,
    errorMessage: capture(error instanceof Error ? error.message : string(info.message) || String(error), 2048).value,
    retryable: typeof info.retryable === "boolean" ? info.retryable : undefined,
  }
}

export function resultFacts(tool: string, provider: string | undefined, value: unknown) {
  const result = record(value)
  const metadata = record(result.metadata)
  const mcp = provider ? mcpFacts(provider, tool, value) : undefined
  const failed =
    mcp?.isError ||
    (tool === "bash" && typeof metadata.exit === "number" && metadata.exit !== 0) ||
    (tool === "extract_document" && Boolean(metadata.error))
  const summary = capture(result.output ?? result.content ?? result.structuredContent ?? value, 4096)
  return {
    status:
      metadata.timedOut === true ? "timeout" : metadata.aborted === true ? "cancelled" : failed ? "failure" : "success",
    resultSummary: summary.value,
    outputBytes: typeof result.output === "string" ? Buffer.byteLength(result.output) : undefined,
    outputTruncated: metadata.truncated === true || summary.truncated,
    resultRedactedFields: summary.redactedFields,
    resultOmittedFields: summary.omittedFields,
    resourceCount: mcp?.resources.length ?? (Array.isArray(result.attachments) ? result.attachments.length : undefined),
    errorCode: mcp?.isError ? "MCP_TOOL_ERROR" : failed ? string(metadata.error) || "NON_ZERO_EXIT" : undefined,
    errorType: failed ? "ToolResultError" : metadata.timedOut === true ? "TimeoutError" : undefined,
    errorMessage: failed
      ? capture(metadata.errorMessage ?? metadata.error ?? result.output ?? result.content, 2048).value
      : undefined,
    toolDetails: capture(
      {
        ...(mcp
          ? {
              serverName: provider,
              isError: mcp.isError,
              taskId: mcp.taskId || undefined,
              businessStatus: mcp.status || undefined,
            }
          : {}),
        ...(tool === "bash" ? { exitCode: metadata.exit, shell: metadata.shell } : {}),
        ...(tool === "skill" ? { skill: metadata.name } : {}),
        ...(tool === "task" ? { childSessionId: metadata.sessionId } : {}),
        ...(tool === "extract_document"
          ? { format: metadata.format, chars: metadata.chars, pages: metadata.pages, error: metadata.error }
          : {}),
      },
      2048,
    ).value,
  }
}
