// SPEC-INS-014 §10:薄封装,拉取 <projectDir>/.octo/<sessionId>/{uploads,outputs}/[/path] 列表。
// 服务端实现在类型化 HttpApi 的 insight 分组(packages/opencode/.../httpapi/{groups,handlers}/insight.ts)。
// content/delete/archive/delete-batch 复用站内 artifact 分组的同款端点(它们按绝对 path 操作,
// 与存储目录无关,insight 文件同样是 projectDir 下的绝对路径),故此处只封 list/upload/upload-folder。

import { directoryHeader } from "@/utils/headers"
import { getDesktopApi } from "../lib/electron-api"

export type InsightFileCategory = "uploads" | "outputs"

export interface InsightFileEntry {
  name: string
  path: string
  size: number
  mtime: number
  isFolder: boolean
  // 相对 uploads 根的路径(文件夹导航 / 面包屑用);outputs 段为空串。
  relativePath: string
}

// ── 文件类型分类(SPEC-INS-014 §10.1:类型筛选 / 类型分组用)────────────────
// kind 由客户端按 isFolder + 扩展名派生(worktree 文件类型比 Design 细,office 按 ext 分 word/ppt/excel)。
export type InsightFileKind =
  | "folder"
  | "html"
  | "markdown"
  | "json"
  | "image"
  | "pdf"
  | "word"
  | "ppt"
  | "excel"
  | "code"
  | "text"
  | "video"
  | "other"

const KIND_LABELS: Record<InsightFileKind, string> = {
  folder: "文件夹",
  html: "HTML 页面",
  markdown: "Markdown",
  json: "JSON",
  image: "图片",
  pdf: "PDF",
  word: "Word 文档",
  ppt: "PPT 演示",
  excel: "表格",
  code: "代码",
  text: "文本",
  video: "视频",
  other: "其他",
}

const KIND_PRIORITY: Record<InsightFileKind, number> = {
  folder: -1,
  html: 0,
  markdown: 1,
  json: 2,
  image: 3,
  pdf: 4,
  word: 5,
  ppt: 6,
  excel: 7,
  code: 8,
  text: 9,
  video: 10,
  other: 11,
}

const CODE_EXTS = new Set([
  "js", "ts", "jsx", "tsx", "mjs", "cjs", "py", "java", "go", "rs", "c", "cpp", "cc", "h", "hpp",
  "cs", "rb", "php", "sh", "bash", "zsh", "sql", "yaml", "yml", "toml", "xml", "css", "scss", "vue", "svelte",
])
const TEXT_EXTS = new Set(["txt", "text", "log", "rtf", "csv", "tsv"])

/** 按文件名扩展名派生 InsightFileKind(文件夹由 isFolder 单独判定,不走这里)。 */
export function fileKind(fileName: string): InsightFileKind {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "html" || ext === "htm" || ext === "xhtml") return "html"
  if (ext === "md" || ext === "markdown" || ext === "mdown" || ext === "mkd") return "markdown"
  if (ext === "json" || ext === "json5" || ext === "jsonc") return "json"
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tiff", "tif", "ico", "heic", "avif"].includes(ext)) return "image"
  if (ext === "pdf") return "pdf"
  if (ext === "doc" || ext === "docx" || ext === "odt" || ext === "pages") return "word"
  if (ext === "ppt" || ext === "pptx" || ext === "odp" || ext === "key") return "ppt"
  if (["xls", "xlsx", "xlsm", "xlsb", "ods", "csv", "tsv", "numbers"].includes(ext)) return "excel"
  if (["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"].includes(ext)) return "video"
  if (ext === "txt" || ext === "text" || ext === "log") return "text"
  if (CODE_EXTS.has(ext)) return "code"
  if (TEXT_EXTS.has(ext)) return "text"
  return "other"
}

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html", htm: "text/html",
  svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav",
  md: "text/markdown", markdown: "text/markdown",
  txt: "text/plain", csv: "text/csv",
  json: "application/json",
  js: "application/javascript", ts: "application/typescript", css: "text/css",
  pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

/** 按文件名扩展名派生 mime(预览面板判定图片/视频/音频/html/markdown/code 用)。 */
export function mimeForName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

export function kindLabel(kind: InsightFileKind): string {
  return KIND_LABELS[kind]
}

export function kindSortPriority(kind: InsightFileKind): number {
  return KIND_PRIORITY[kind]
}

/** 服务端条目 + 客户端派生的 kind/mime,供文件管理面板的分组 / 排序 / 筛选 / 预览用。 */
export interface InsightFile extends InsightFileEntry {
  kind: InsightFileKind
  mime: string
}

export function toInsightFile(entry: InsightFileEntry): InsightFile {
  return {
    ...entry,
    kind: entry.isFolder ? "folder" : fileKind(entry.name),
    mime: entry.isFolder ? "" : mimeForName(entry.name),
  }
}

export async function fetchInsightFiles(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
  category: InsightFileCategory,
  subPath?: string,
): Promise<InsightFileEntry[]> {
  const params = new URLSearchParams({ sessionId, category })
  if (category === "uploads" && subPath && subPath.trim() !== "") params.set("path", subPath)
  const res = await fetch(`${sdkUrl}/insight/files?${params.toString()}`, {
    headers: { ...directoryHeader(sdkDirectory) },
  })
  if (!res.ok) {
    console.error("[octo:insight-files] list-failed", { sessionId, category, subPath, status: res.status })
    throw new Error(`列出文件失败: ${res.statusText}`)
  }
  const data = (await res.json()) as { files: InsightFileEntry[] }
  console.log("[octo:insight-files] list-ok", { sessionId, category, subPath, count: data.files.length })
  return data.files
}

export interface InsightContentResponse {
  content: string
  mimeType: string
  encoding?: "base64"
}

// 读文件内容:复用 artifact/content(按绝对 path,与存储目录无关)。
export async function fetchInsightContent(
  sdkUrl: string,
  sdkDirectory: string,
  filePath: string,
): Promise<InsightContentResponse> {
  const res = await fetch(`${sdkUrl}/artifact/content?path=${encodeURIComponent(filePath)}`, {
    headers: { ...directoryHeader(sdkDirectory) },
  })
  if (!res.ok) throw new Error(`读取文件失败: ${res.statusText}`)
  return res.json()
}

// 删单文件:复用 artifact DELETE(按绝对 path)。
export async function deleteInsightFile(
  sdkUrl: string,
  sdkDirectory: string,
  filePath: string,
): Promise<void> {
  const res = await fetch(`${sdkUrl}/artifact/file?path=${encodeURIComponent(filePath)}`, {
    method: "DELETE",
    headers: { ...directoryHeader(sdkDirectory) },
  })
  if (!res.ok) throw new Error(`删除文件失败: ${res.statusText}`)
}

// 批量删除:复用 artifact/delete-batch。
export async function deleteInsightBatch(
  sdkUrl: string,
  sdkDirectory: string,
  files: string[],
): Promise<{ deleted: number }> {
  const res = await fetch(`${sdkUrl}/artifact/delete-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
    body: JSON.stringify({ files }),
  })
  if (!res.ok) throw new Error(`批量删除失败: ${res.statusText}`)
  const data = await res.json()
  return { deleted: data.deleted }
}

// 打包下载(zip):复用 artifact/archive。
export async function archiveInsightFiles(
  sdkUrl: string,
  sdkDirectory: string,
  files: string[],
): Promise<Blob> {
  const res = await fetch(`${sdkUrl}/artifact/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
    body: JSON.stringify({ files }),
  })
  if (!res.ok) throw new Error(`打包下载失败: ${res.statusText}`)
  return res.blob()
}

export interface InsightFolderUploadFile {
  relativePath: string
  content: string
}

export async function uploadInsightFile(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
  filename: string,
  content: string,
  targetPath?: string,
): Promise<InsightFileEntry> {
  const res = await fetch(`${sdkUrl}/insight/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
    body: JSON.stringify({ sessionId, filename, content, path: targetPath }),
  })
  if (!res.ok) throw new Error(`上传失败: ${res.statusText}`)
  return res.json()
}

export async function uploadInsightFolder(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
  folderName: string,
  files: InsightFolderUploadFile[],
  currentPath?: string,
): Promise<{ name: string; path: string; fileCount: number; mtime: number }> {
  const res = await fetch(`${sdkUrl}/insight/upload-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...directoryHeader(sdkDirectory) },
    body: JSON.stringify({ sessionId, folderName, files, path: currentPath }),
  })
  if (!res.ok) throw new Error(`上传文件夹失败: ${res.statusText}`)
  return res.json()
}

/** 把本地绝对路径转成 local:// URL(electron 拦截该协议直接读盘),供图片/视频等预览/缩略图用。 */
export function pathToLocalUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  return `local:///${normalized}`
}

/** 是否桌面端(electron):有 window.api 即是。预览面板据此决定 HTML 走 local:// 还是 data URL。 */
export function isElectronDesktop(): boolean {
  // typeof window 的守卫要留在前面短路:getDesktopApi() 直接读 window,SSR 下会 ReferenceError。
  return typeof window !== "undefined" && getDesktopApi() !== undefined
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatTimeAgo(ms: number): string {
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} 天前`
  if (hours > 0) return `${hours} 小时前`
  if (minutes > 0) return `${minutes} 分钟前`
  return `刚刚`
}
