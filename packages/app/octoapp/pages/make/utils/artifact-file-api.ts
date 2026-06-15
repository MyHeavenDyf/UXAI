import type { OutputCard, OutputCardType } from "../components/insight-turn"

export type ArtifactFileKind =
  | "html"
  | "svg"
  | "image"
  | "video"
  | "audio"
  | "markdown"
  | "text"
  | "code"
  | "pdf"
  | "document"
  | "binary"

export interface ArtifactFile {
  name: string
  path: string
  sessionId: string
  kind: ArtifactFileKind
  size: number
  mtime: number
  mime: string
}

export interface ArtifactListResponse {
  files: ArtifactFile[]
}

export interface ArtifactContentResponse {
  content: string
  mimeType: string
  encoding?: "base64"
}

export async function fetchArtifactList(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
): Promise<ArtifactListResponse> {
  const response = await fetch(`${sdkUrl}/artifact/list?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { "x-opencode-directory": sdkDirectory },
  })
  if (!response.ok) {
    throw new Error(`Failed to list artifacts: ${response.statusText}`)
  }
  return response.json()
}

export async function fetchArtifactContent(
  sdkUrl: string,
  sdkDirectory: string,
  filePath: string,
): Promise<ArtifactContentResponse> {
  const response = await fetch(`${sdkUrl}/artifact/content?path=${encodeURIComponent(filePath)}`, {
    headers: { "x-opencode-directory": sdkDirectory },
  })
  if (!response.ok) {
    throw new Error(`Failed to read artifact: ${response.statusText}`)
  }
  return response.json()
}

export async function deleteArtifactFile(
  sdkUrl: string,
  sdkDirectory: string,
  filePath: string,
): Promise<void> {
  const response = await fetch(`${sdkUrl}/artifact/file?path=${encodeURIComponent(filePath)}`, {
    method: "DELETE",
    headers: { "x-opencode-directory": sdkDirectory },
  })
  if (!response.ok) {
    throw new Error(`Failed to delete artifact: ${response.statusText}`)
  }
}

export async function renameArtifactFile(
  sdkUrl: string,
  sdkDirectory: string,
  from: string,
  to: string,
): Promise<ArtifactFile> {
  const response = await fetch(`${sdkUrl}/artifact/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": sdkDirectory },
    body: JSON.stringify({ from, to }),
  })
  if (!response.ok) {
    throw new Error(`Failed to rename artifact: ${response.statusText}`)
  }
  return response.json()
}

export async function archiveArtifacts(
  sdkUrl: string,
  sdkDirectory: string,
  files: string[],
): Promise<Blob> {
  const response = await fetch(`${sdkUrl}/artifact/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": sdkDirectory },
    body: JSON.stringify({ files }),
  })
  if (!response.ok) {
    throw new Error(`Failed to archive artifacts: ${response.statusText}`)
  }
  return response.blob()
}

export async function deleteArtifactBatch(
  sdkUrl: string,
  sdkDirectory: string,
  files: string[],
): Promise<{ deleted: number }> {
  const response = await fetch(`${sdkUrl}/artifact/delete-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": sdkDirectory },
    body: JSON.stringify({ files }),
  })
  if (!response.ok) {
    throw new Error(`Failed to batch delete artifacts: ${response.statusText}`)
  }
  const data = await response.json()
  return { deleted: data.deleted }
}

export async function uploadArtifactFile(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
  filename: string,
  content: string,
): Promise<ArtifactFile> {
  const response = await fetch(`${sdkUrl}/artifact/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": sdkDirectory },
    body: JSON.stringify({ sessionId, filename, content }),
  })
  if (!response.ok) {
    throw new Error(`Failed to upload artifact: ${response.statusText}`)
  }
  return response.json()
}

export function kindLabel(kind: ArtifactFileKind): string {
  const labels: Record<ArtifactFileKind, string> = {
    html: "HTML",
    svg: "SVG",
    image: "Image",
    video: "Video",
    audio: "Audio",
    markdown: "Markdown",
    text: "Text",
    code: "Code",
    pdf: "PDF",
    document: "Document",
    binary: "Binary",
  }
  return labels[kind]
}

export function kindSortPriority(kind: ArtifactFileKind): number {
  const priority: Record<ArtifactFileKind, number> = {
    html: 0,
    svg: 1,
    markdown: 2,
    image: 3,
    code: 4,
    text: 5,
    pdf: 6,
    video: 7,
    audio: 8,
    document: 9,
    binary: 10,
  }
  return priority[kind]
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatTimestamp(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  if (date >= today) {
    return `Today ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  if (date >= yesterday) {
    return `Yesterday ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export function artifactFileToOutputCard(file: ArtifactFile): OutputCard {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  let type: OutputCardType = "html"

  if (ext === "svg") type = "svg"
  else if (ext === "md" || ext === "markdown") type = "markdown-document"
  else if (ext === "json") type = "json"

  return {
    id: file.path,
    title: file.name,
    type,
    content: "",
    filePath: file.path,
    createdAt: new Date(file.mtime),
  }
}