import path from "node:path"
import { createHash } from "node:crypto"
import { resolveOutputType } from "./output-type"

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function string(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function hash(...values: string[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex")
}

// Only inspect protocol envelopes, never arbitrary text/URLs or binary attachments.
function envelopes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value == null) return []
  if (typeof value === "string") return envelopes(json(value), depth + 1)
  if (Array.isArray(value)) return value.flatMap((item) => envelopes(item, depth + 1))
  if (typeof value !== "object") return []
  const data = record(value)
  return [
    data,
    ...(data.type === "text" ? envelopes(json(data.text), depth + 1) : []),
    ...["structuredContent", "content", "metadata", "resource_link"].flatMap((key) =>
      key in data ? envelopes(data[key], depth + 1) : [],
    ),
  ]
}

export function mcpFacts(provider: string, tool: string, result: unknown) {
  const objects = envelopes(result)
  const task = objects.find((item) => string(item.task_id))
  const resources = [
    ...new Map(
      objects
        .filter((item) => item.type === "resource_link" && string(item.uri))
        .map((item) => [JSON.stringify([item.resourceId, item.resource_id, item.uri, item.name]), item]),
    ).values(),
  ]
  return {
    provider,
    tool: tool.replace(new RegExp(`^${provider.replace(/[^a-zA-Z0-9_-]/g, "_")}_`), ""),
    isError: objects.some((item) => item.isError === true),
    taskId: string(task?.task_id),
    status: string(task?.status ?? objects.find((item) => string(item.status))?.status),
    resources: resources.map((item) => ({
      // Provider identity never comes from signed URIs or display names.
      // The UXR immutable-manifest fallback is assigned atomically in the store.
      id: string(
        item.resourceId ?? item.resource_id ?? record(item._meta).resourceId ?? record(item._meta).resource_id,
      ),
      name: string(item.name),
      mime: string(item.mimeType),
      tool: string(item.business_type),
    })),
  }
}

export type MCPFacts = ReturnType<typeof mcpFacts>

export function fileFact(
  tool: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  directory: string,
) {
  if (tool !== "write" && tool !== "edit") return
  const file = string(metadata.filepath) || string(input.filePath)
  if (!file) return
  const implementation = /^[a-z]:[/\\]/i.test(directory) ? path.win32 : path
  const resolved = implementation.resolve(directory, file)
  return {
    identity: implementation === path.win32 ? resolved.replaceAll("\\", "/").toLowerCase() : resolved,
    type: resolveOutputType(file),
    name: tool === "write" ? "artifact-file-write" : "artifact-file-edit",
  }
}
