import path from "path"
import { Effect, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

// Shared helpers for the artifact routes, used by both the legacy Hono route
// (`artifact.ts`) and the Effect HttpApi handler (`httpapi/handlers/artifact.ts`).

export const SESSION_BASE_DIR = ".octo"
export const OUTPUTS_DIR = "outputs"
export const UPLOADS_DIR = "uploads"

const KIND_BY_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp4: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  js: "code",
  ts: "code",
  json: "code",
  css: "code",
  pdf: "pdf",
}

const MIME_MAP: Record<string, string> = {
  html: "text/html",
  svg: "image/svg+xml",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  js: "application/javascript",
  ts: "application/typescript",
  css: "text/css",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
}

export function getKind(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return KIND_BY_EXT[ext] ?? "binary"
}

export function getMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return MIME_MAP[ext] ?? "application/octet-stream"
}

export function sanitizePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (normalized.includes("..") || normalized.includes("~") || normalized.length === 0) {
    return ""
  }
  return normalized
}

export type ArtifactFileInfo = {
  name: string
  path: string
  relativePath: string
  sessionId: string
  kind: string
  isFolder: boolean
  size: number
  mtime: number
  mime: string
}

const ARTIFACT_SCAN_CONCURRENCY = 8

function collectArtifactEntry(
  fs: AppFileSystem.Interface,
  dir: string,
  baseRelativePath: string,
  sessionId: string,
  name: string,
): Effect.Effect<ArtifactFileInfo[]> {
  return Effect.gen(function* () {
    const fullPath = path.join(dir, name)
    const relativePath = baseRelativePath ? `${baseRelativePath}/${name}` : name
    const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
    if (!stat) return []
    if (stat.type === "Directory") {
      const nested: ArtifactFileInfo[] = []
      yield* collectArtifactFiles(fs, fullPath, relativePath, sessionId, nested)
      return nested
    }
    const size = typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0)
    const mtime = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()
    return [{
      name,
      path: fullPath,
      relativePath,
      sessionId,
      kind: getKind(name),
      isFolder: false,
      size,
      mtime,
      mime: getMime(name),
    }]
  })
}

// 并发扫描目录，`Effect.forEach` 保持返回顺序，最终落盘顺序与串行版一致。
export function collectArtifactFiles(
  fs: AppFileSystem.Interface,
  dir: string,
  baseRelativePath: string,
  sessionId: string,
  files: ArtifactFileInfo[],
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))
    const collected = yield* Effect.forEach(
      entries.filter((name) => !name.startsWith(".")),
      (name) => collectArtifactEntry(fs, dir, baseRelativePath, sessionId, name),
      { concurrency: ARTIFACT_SCAN_CONCURRENCY },
    )
    for (const group of collected) files.push(...group)
  })
}
