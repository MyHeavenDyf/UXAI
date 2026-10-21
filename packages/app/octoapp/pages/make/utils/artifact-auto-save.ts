import type { OutputCard } from "../components/insight-turn"
import { getDesktopApi } from "../lib/electron-api"
import type { WorkspaceKind } from "@/context/server"

export const ARTIFACTS_SUBDIR = ".octo"
export const CODE_OUTPUT_SUBDIR = "output"

/**
 * sid 前 12 位 = `ses_` 之后的时间戳+计数器 hex 段,与会话一一对应且稳定;
 * 与服务端 workspace-upgrade 迁移命名(opencode src/session/workspace-upgrade.ts sidPrefix)
 * 保持逐字一致,规则改动需两侧同步。
 */
function sidPrefix(sessionId: string): string {
  return sessionId.startsWith("ses_") && sessionId.length >= 16 ? sessionId.slice(4, 16) : sessionId
}

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

// kind="code"(代码工作区): 产物落 <projectDir>/output/<sid 前 12 位>-<原名>,与
// workspace-upgrade 迁移命名一致 —— 升级后的工作区恢复会话时 auto-save 会命中迁移
// 副本直接跳过,不会再在项目根写原始名副本(跨会话前缀也避免同名产物互相覆盖);
// 缺省 "normal": 落 <projectDir>/.octo/<sessionId>/outputs/ (原行为)。
export function computeArtifactFilePath(
  title: string,
  type: OutputCard["type"],
  sessionId: string,
  projectDir: string,
  kind?: WorkspaceKind,
): string {
  const sep = projectDir.includes("\\") ? "\\" : "/"
  const baseName = hasExtension(title, type) ? title : title + getExtension(type)
  const filename = sanitizeFilename(baseName)
  if (kind === "code") return [projectDir, CODE_OUTPUT_SUBDIR, `${sidPrefix(sessionId)}-${filename}`].join(sep)
  return [projectDir, ...ARTIFACTS_SUBDIR.split("/"), sessionId, "outputs", filename].join(sep)
}

export async function inferArtifactFilePath(
  title: string,
  type: OutputCard["type"],
  sessionId: string,
  projectDir: string,
  kind?: WorkspaceKind,
): Promise<{ filePath: string; exists: boolean }> {
  const api = getDesktopApi()
  const filePath = computeArtifactFilePath(title, type, sessionId, projectDir, kind)

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
  kind?: WorkspaceKind,
): Promise<string | undefined> {
  const api = getDesktopApi()
  if (!api?.writeFileBuffer || !api?.readFileBuffer) return

  const saveable = ["html", "deck", "svg", "markdown-document", "markdown", "code-snippet"]
  if (!saveable.includes(card.type)) return

  const content = extractFileContent(card)
  if (!content) return

  const filePath = computeArtifactFilePath(card.title, card.type, sessionId, projectDir, kind)

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
