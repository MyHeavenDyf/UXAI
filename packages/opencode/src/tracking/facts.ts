import path from "node:path"
import { createHash } from "node:crypto"
import { resolveOutputType } from "./output-type"

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function string(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function json(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return record(value)
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function identity(file: string, directory: string, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix
  const resolved = api.resolve(directory, file).replace(/\\/g, "/")
  return platform === "win32" ? resolved.toLowerCase() : resolved
}

export function toolIs(tool: string, name: string) {
  return tool === name || tool.endsWith(`:${name}`) || tool.endsWith(`_${name}`)
}

export type Resource = {
  uri: string
  name: string
  mimeType?: string
  business_type?: string
  stableId?: string
}

export function resources(value: unknown, depth = 0): Resource[] {
  if (depth > 7) return []
  if (Array.isArray(value)) return value.flatMap((v) => resources(v, depth + 1))
  const obj = record(value)
  if (obj.type === "resource_link" && string(obj.uri)) {
    const stableId =
      string(obj.stableId) ??
      string(obj.resourceId) ??
      string(obj.resource_id) ??
      string(obj.artifactId) ??
      string(obj.artifact_id) ??
      string(obj.id)
    return [
      {
        uri: String(obj.uri),
        name: string(obj.name) ?? "",
        mimeType: string(obj.mimeType),
        business_type: string(obj.business_type),
        stableId,
      },
    ]
  }
  return [
    obj.content,
    obj.resource_link,
    obj.metadata,
    obj.structuredContent,
    obj.octoArtifactResult,
    obj.state,
    obj.type === "text" ? json(obj.text) : undefined,
    typeof obj.output === "string" ? json(obj.output) : obj.output,
  ].flatMap((v) => resources(v, depth + 1))
}

// Preserve only resource/task facts, not the full tool response or document contents.
export function mcpFact(result: unknown) {
  const obj = record(result)
  const meta = record(obj.metadata)
  const texts = Array.isArray(obj.content) ? obj.content.map((v) => json(record(v).text)) : []
  const embedded = texts.find((v) => v.structuredContent || v.task_id) ?? {}
  const sc = record(
    obj.structuredContent ??
      meta.structuredContent ??
      (meta.task_id ? meta : undefined) ??
      embedded.structuredContent ??
      embedded,
  )
  return {
    content: resources(result).map((link) => ({ type: "resource_link", ...link })),
    structuredContent: { task_id: sc.task_id, status: sc.status },
    isError: obj.isError === true,
  }
}

export function taskInfo(part: unknown) {
  const state = record(record(part).state)
  const meta = record(state.metadata)
  const saved = record(meta.octoArtifactResult)
  const sc = record(saved.structuredContent ?? meta.structuredContent ?? json(state.output).structuredContent ?? meta)
  return {
    id:
      string(sc.task_id) ??
      (typeof sc.task_id === "number" ? String(sc.task_id) : undefined) ??
      string(record(state.input).task_id),
    status: string(sc.status),
  }
}

export type Artifact = {
  name: "artifact-file-write" | "artifact-file-edit" | "artifact-mcp-return"
  identity: string
  type: string
  source: "write" | "edit" | "mcp" | "script"
  tool?: string
  occurredAt: number
}

export function mcpProvider(tool: string) {
  const bare = [
    "get_task_result",
    "stop_task",
    "key_findings",
    "run_guide_analysis",
    "run_usability_analysis",
    "mindmap",
  ].find((name) => toolIs(tool, name))
  if (!bare) return tool
  return tool.slice(0, -bare.length).replace(/[_:-]+$/, "") || "unknown"
}

export function stableResourceIdentity(link: Resource, tool: string, taskID?: string) {
  if (!link.stableId) return
  return JSON.stringify([mcpProvider(tool), taskID ?? "sync", link.stableId])
}

export function unresolvedResources(part: unknown) {
  const p = record(part)
  const state = record(p.state)
  if (p.type !== "tool" || state.status !== "completed") return []
  const tool = string(p.tool) ?? ""
  if (toolIs(tool, "write") || toolIs(tool, "edit") || toolIs(tool, "stop_task")) return []
  return resources(part).filter((link) => !stableResourceIdentity(link, tool, taskInfo(part).id))
}

export function artifacts(part: unknown, directory: string): Artifact[] {
  const p = record(part)
  const state = record(p.state)
  if (p.type !== "tool" || state.status !== "completed") return []
  const tool = string(p.tool) ?? ""
  const meta = record(state.metadata)
  const input = record(state.input)
  const time = record(state.time)
  const occurredAt = typeof time.end === "number" ? time.end : 0
  const file = string(meta.filepath) ?? string(input.filePath) ?? string(input.path) ?? string(input.file_path)
  const source = toolIs(tool, "write") ? "write" : toolIs(tool, "edit") ? "edit" : undefined
  if (source && file)
    return [
      {
        name: source === "write" ? "artifact-file-write" : "artifact-file-edit",
        identity: identity(file, directory),
        type: resolveOutputType(file),
        source,
        occurredAt,
      },
    ]
  if (
    toolIs(tool, "stop_task") ||
    record(meta.octoArtifactResult).isError === true ||
    json(state.output).isError === true
  )
    return []
  const taskID = taskInfo(part).id
  return resources(part).flatMap((link) => {
    const resourceIdentity = stableResourceIdentity(link, tool, taskID)
    if (!resourceIdentity) return []
    return [
      {
        name: "artifact-mcp-return" as const,
        identity: resourceIdentity,
        type: resolveOutputType(link.name, link.mimeType),
        source: "mcp" as const,
        tool: link.business_type ?? "unknown",
        occurredAt,
      },
    ]
  })
}
