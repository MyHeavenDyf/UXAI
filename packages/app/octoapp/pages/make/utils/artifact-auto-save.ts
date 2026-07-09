import type { OutputCard } from "../components/insight-turn"
import { getDesktopApi } from "../lib/electron-api"

export const ARTIFACTS_SUBDIR = ".octo/artifacts/make"

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
}

export function extractFileContent(card: OutputCard): string {
  const raw = card.content
  const fenceMatch = raw.match(/```html\s*\n([\s\S]*?)\n?```/i)
  if (fenceMatch) return fenceMatch[1].trim()
  return raw.trim()
}

export function getExtension(type: OutputCard["type"]): string {
  switch (type) {
    case "html":
    case "deck":
      return ".html"
    case "svg":
      return ".svg"
    case "markdown":
    case "markdown-document":
      return ".md"
    case "json":
      return ".json"
    case "code-snippet":
      return ".txt"
    default:
      return ".html"
  }
}

export function hasExtension(title: string, type: OutputCard["type"]): boolean {
  const ext = getExtension(type)
  return title.toLowerCase().endsWith(ext.toLowerCase())
}

export function computeArtifactFilePath(
  title: string,
  type: OutputCard["type"],
  sessionId: string,
  projectDir: string,
): string {
  const sep = projectDir.includes("\\") ? "\\" : "/"
  const baseName = hasExtension(title, type) ? title : title + getExtension(type)
  const filename = sanitizeFilename(baseName)
  return [projectDir, ...ARTIFACTS_SUBDIR.split("/"), sessionId, filename].join(sep)
}

export async function inferArtifactFilePath(
  title: string,
  type: OutputCard["type"],
  sessionId: string,
  projectDir: string,
): Promise<{ filePath: string; exists: boolean }> {
  const api = getDesktopApi()
  const filePath = computeArtifactFilePath(title, type, sessionId, projectDir)
  
  if (!api?.readFileBuffer) {
    return { filePath, exists: false }
  }
  
  const existing = await api.readFileBuffer(filePath)
  return { filePath, exists: existing !== null }
}

export async function autoSaveArtifact(
  sessionId: string,
  card: OutputCard,
  projectDir: string,
): Promise<string | undefined> {
  const api = getDesktopApi()
  if (!api?.writeFileBuffer || !api?.readFileBuffer) return

  const saveable = ["html", "deck", "svg", "markdown-document", "markdown", "code-snippet"]
  if (!saveable.includes(card.type)) return

  const content = extractFileContent(card)
  if (!content) return

  const sep = projectDir.includes("\\") ? "\\" : "/"
  const baseName = hasExtension(card.title, card.type) ? card.title : card.title + getExtension(card.type)
  const filename = sanitizeFilename(baseName)
  const filePath = [projectDir, ...ARTIFACTS_SUBDIR.split("/"), sessionId, filename].join(sep)

  // 检查文件是否已存在，不覆盖用户编辑的内容
  const existing = await api.readFileBuffer(filePath)
  if (existing !== null) {
    console.log("[autoSaveArtifact] File already exists, skipping:", filePath)
    return filePath
  }

  const encoder = new TextEncoder()
  const buffer = encoder.encode(content).buffer as ArrayBuffer

  await api.writeFileBuffer(filePath, buffer)
  return filePath
}

export async function saveArtifactContent(
  filePath: string,
  content: string,
): Promise<void> {
  const api = getDesktopApi()
  if (!api?.writeFileBuffer) {
    throw new Error("Desktop API not available")
  }

  const encoder = new TextEncoder()
  const buffer = encoder.encode(content).buffer as ArrayBuffer

  await api.writeFileBuffer(filePath, buffer)
}
