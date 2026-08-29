// SPEC-INS-014 §10:薄封装,拉取 <projectDir>/.octo/<sessionId>/{uploads,outputs}/[/path] 列表。
// 服务端实现在类型化 HttpApi 的 insight 分组(packages/opencode/.../httpapi/{groups,handlers}/insight.ts)。
// content/delete/archive/delete-batch 复用站内 artifact 分组的同款端点(它们按绝对 path 操作,
// 与存储目录无关,insight 文件同样是 projectDir 下的绝对路径),故此处只封 list/upload/upload-folder。

import { directoryHeader } from "@/utils/headers"
import { getDesktopApi } from "../lib/electron-api"
import { extOf, resolveOutputType } from "./output-type"

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

// ── kind 派生:**必须**建立在 resolveOutputType 之上 ────────────────────────
// SPEC-INS-026 §4.2:文件管理的 kind 保留(筛选/分组/图标要比 6 个产物类型更细),但不再
// 独立按扩展名判 —— 那是系统里的第三套判定,曾让同一文件在「文件管理说是什么」和「打开后
// 按什么渲染」上给出不同答案(如 .csv:excel vs table vs file)。
//
// 现在只做 resolveOutputType 之下的细分,两级都由同一张扩展名表驱动:
//   file → pdf / word / ppt / excel / video / other(office 类要各自的图标)
//   code → code / text(代码高亮 vs 纯文本,同样是应用内文本预览)
//   其余 → 与产物类型同名(html / markdown / json / image)

/** resolveOutputType 判为 `file` 时的细分。查不到的(压缩包/字体/可执行/音频等)落 other。 */
const FILE_KIND_BY_EXT: Record<string, InsightFileKind> = {
  pdf: "pdf",
  doc: "word", docx: "word", odt: "word", pages: "word", rtf: "word",
  ppt: "ppt", pptx: "ppt", odp: "ppt", key: "ppt",
  xls: "excel", xlsx: "excel", xlsm: "excel", xlsb: "excel", ods: "excel",
  csv: "excel", tsv: "excel", numbers: "excel",
  mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video",
  flv: "video", wmv: "video", m4v: "video",
}

/** resolveOutputType 判为 `code` 时的细分:命中即「代码」,其余(含 txt/log/未知扩展名)算「文本」。 */
const CODE_EXTS = new Set([
  "js", "ts", "jsx", "tsx", "mjs", "cjs", "py", "java", "go", "rs", "c", "cpp", "cc", "h", "hpp",
  "cs", "rb", "php", "sh", "bash", "zsh", "sql", "yaml", "yml", "toml", "xml", "css", "scss", "vue", "svelte",
])

/** 按文件名派生 InsightFileKind(文件夹由 isFolder 单独判定,不走这里)。 */
export function fileKind(fileName: string): InsightFileKind {
  const ext = extOf(fileName)
  switch (resolveOutputType(fileName)) {
    case "html": return "html"
    case "markdown": return "markdown"
    case "json": return "json"
    case "image": return "image"
    case "file": return FILE_KIND_BY_EXT[ext] ?? "other"
    case "code": return CODE_EXTS.has(ext) ? "code" : "text"
  }
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
  options?: { subPath?: string; recursive?: boolean },
): Promise<InsightFileEntry[]> {
  const subPath = options?.subPath
  const recursive = options?.recursive
  const params = new URLSearchParams({ sessionId, category })
  if (category === "uploads" && subPath && subPath.trim() !== "") params.set("path", subPath)
  if (recursive) params.set("recursive", "true")
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
