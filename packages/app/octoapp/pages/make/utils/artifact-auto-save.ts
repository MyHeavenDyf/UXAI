import type { OutputCard } from "../components/insight-turn"
import { getDesktopApi } from "../lib/electron-api"

const ARTIFACTS_SUBDIR = ".octo/artifacts/make"

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
}

function extractFileContent(card: OutputCard): string {
  const raw = card.content
  const fenceMatch = raw.match(/```html\s*\n([\s\S]*?)\n?```/i)
  if (fenceMatch) return fenceMatch[1].trim()
  return raw.trim()
}

function getExtension(type: OutputCard["type"]): string {
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

export async function autoSaveArtifact(
  sessionId: string,
  card: OutputCard,
  projectDir: string,
): Promise<string | undefined> {
  const api = getDesktopApi()
  if (!api?.writeFileBuffer) return

  const saveable = ["html", "deck", "svg", "markdown-document", "markdown", "code-snippet"]
  if (!saveable.includes(card.type)) return

  const content = extractFileContent(card)
  if (!content) return

  const sep = projectDir.includes("\\") ? "\\" : "/"
  const filename = sanitizeFilename(card.title) + getExtension(card.type)
  const filePath = [projectDir, ...ARTIFACTS_SUBDIR.split("/"), sessionId, filename].join(sep)

  const encoder = new TextEncoder()
  const buffer = encoder.encode(content).buffer as ArrayBuffer

  await api.writeFileBuffer(filePath, buffer)
  return filePath
}
