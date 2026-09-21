import type { OutputCard, OutputCardType } from "../components/insight-turn"
import { directoryHeader } from "@/utils/headers"
import { extractSubtypeFromFilename } from "./subtype-extractor"
import { isCodeFile } from "./code-highlight"

export type ArtifactFileKind =
  | "folder"
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
  relativePath: string
  sessionId: string
  kind: ArtifactFileKind
  isFolder: boolean
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
  category: "generated" | "uploaded",
  subPath?: string,
  recursive?: boolean,
): Promise<ArtifactListResponse> {
  const params = new URLSearchParams({
    sessionId,
    category,
  })
  if (subPath && subPath.trim() !== "") {
    params.set("path", subPath)
  }
  if (recursive) {
    params.set("recursive", "true")
  }
  const url = `${sdkUrl}/artifact/list?${params.toString()}`
  const response = await fetch(url, {
    headers: { ...directoryHeader(sdkDirectory) },
  })
  if (!response.ok) {
    throw new Error(`Failed to list artifacts: ${response.statusText}`)
  }
  const data: ArtifactListResponse = await response.json()
  for (const file of data.files) {
    if (file.isFolder) continue
    if ((file.kind === "binary" || file.kind === "document") && isCodeFile(file.name)) {
      file.kind = "code"
    }
  }
  return data
}

export async function fetchArtifactContent(
  sdkUrl: string,
  sdkDirectory: string,
  filePath: string,
): Promise<ArtifactContentResponse> {
  const response = await fetch(`${sdkUrl}/artifact/content?path=${encodeURIComponent(filePath)}`, {
    headers: { ...directoryHeader(sdkDirectory) },
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
    headers: { ...directoryHeader(sdkDirectory) },
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
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
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
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
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
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
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
  targetPath?: string,
): Promise<ArtifactFile> {
  const response = await fetch(`${sdkUrl}/artifact/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
    body: JSON.stringify({ sessionId, filename, content, path: targetPath }),
  })
  if (!response.ok) {
    throw new Error(`Failed to upload artifact: ${response.statusText}`)
  }
  return response.json()
}

export interface FolderUploadFile {
  relativePath: string
  content: string
}

export interface FolderUploadResponse {
  name: string
  path: string
  relativePath: string
  sessionId: string
  kind: string
  isFolder: boolean
  fileCount: number
  mtime: number
}

// V8 字符串上限约 512MB,HTTP body 通常也有大小限制。
// 单批 base64 累加超过上限会抛 RangeError: Invalid string length,故按字节分批。
// 后端 upload-folder 是幂等的(ensureDir 后逐文件追加写),多次调用同名 folderName+path 安全。
const MAX_FOLDER_BATCH_BYTES = 30 * 1024 * 1024

export async function uploadArtifactFolder(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
  folderName: string,
  files: FolderUploadFile[],
  currentPath?: string,
): Promise<FolderUploadResponse> {
  if (files.length === 0) {
    throw new Error("Cannot upload empty folder")
  }

  const responses: FolderUploadResponse[] = []
  let batch: FolderUploadFile[] = []
  let batchBytes = 0

  const flush = async () => {
    if (batch.length === 0) return
    const response = await fetch(`${sdkUrl}/artifact/upload-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
      body: JSON.stringify({ sessionId, folderName, files: batch, path: currentPath }),
    })
    if (!response.ok) {
      throw new Error(`Failed to upload folder: ${response.statusText}`)
    }
    responses.push((await response.json()) as FolderUploadResponse)
    batch = []
    batchBytes = 0
  }

  for (const file of files) {
    const size = file.content.length
    if (batch.length > 0 && batchBytes + size > MAX_FOLDER_BATCH_BYTES) {
      await flush()
    }
    batch.push(file)
    batchBytes += size
  }
  await flush()

  const last = responses.at(-1)
  if (!last) {
    throw new Error("Failed to upload folder: no response")
  }
  // 分批时最后一批的 fileCount 只是当批数量,改写为总文件数以反映真实上传量
  last.fileCount = files.length
  return last
}

export function kindLabel(kind: ArtifactFileKind): string {
  const labels: Record<ArtifactFileKind, string> = {
    folder: "Folder",
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
    folder: -1,
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

export function formatTimestamp(ms: number, t: (key: string) => string): string {
  const date = new Date(ms)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  if (date >= today) {
    return `${t("designFiles.timeToday")} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  if (date >= yesterday) {
    return `${t("designFiles.timeYesterday")} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export function formatTimeAgo(ms: number): string {
  const now = Date.now()
  const diff = now - ms
  
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `修改于 ${days} 天之前`
  if (hours > 0) return `修改于 ${hours} 小时之前`
  if (minutes > 0) return `修改于 ${minutes} 分钟之前`
  return `修改于 ${seconds} 秒之前`
}

export function artifactFileToOutputCard(file: ArtifactFile): OutputCard {
  const kindToType: Partial<Record<ArtifactFileKind, OutputCardType>> = {
    html: "html",
    svg: "svg",
    image: "image",
    video: "video",
    audio: "audio",
    markdown: "markdown-document",
    text: "text",
    code: "text",
    pdf: "pdf",
  }

  const type = kindToType[file.kind] ?? "file"

  return {
    id: file.path,
    title: file.name,
    type,
    subtype: extractSubtypeFromFilename(file.name),
    content: "",
    filePath: file.path,
    commentFilePath: file.relativePath,
    sessionId: file.sessionId,
    createdAt: new Date(file.mtime),
  }
}

export function getArtifactServeUrl(
  sdkUrl: string,
  directory: string,
  sessionId: string,
  relativePath: string,
): string {
  const params = new URLSearchParams({
    directory,
    sessionId,
    path: relativePath,
  })
  return `${sdkUrl}/artifact/serve?${params.toString()}`
}

export function getArtifactRelativePath(filePath: string): { sessionId: string; relativePath: string } | null {
  const normalized = filePath.replace(/\\/g, "/")
  const sessionBase = ".octo/"
  const idx = normalized.indexOf(sessionBase)
  if (idx === -1) return null
  
  const afterBase = normalized.slice(idx + sessionBase.length)
  const slashIdx = afterBase.indexOf("/")
  if (slashIdx === -1) return null
  
  const sessionId = afterBase.slice(0, slashIdx)
  const relativePath = afterBase.slice(slashIdx + 1)
  
  return { sessionId, relativePath }
}

export function pathToLocalUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  return `local:///${normalized}`
}

export function extractCommentFilePath(absolutePath: string, sessionId: string): string {
  const sessionDir = `.octo/${sessionId}/`
  const normalized = absolutePath.replace(/\\/g, "/")
  const idx = normalized.indexOf(sessionDir)
  if (idx === -1) {
    return normalized.split("/").pop() || ""
  }
  return normalized.slice(idx + sessionDir.length)
}

export function isElectronDesktop(): boolean {
  return typeof window !== "undefined" && typeof (window as any).api !== "undefined"
}