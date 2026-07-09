// SPEC-INS-014 §10:薄封装,拉取 <projectDir>/insight/<sessionId>/{uploads,outputs}/ 列表。
// 服务端实现在类型化 HttpApi 的 insight 分组(不是普通 Hono 路由——本仓开发/预览渠道默认启用
// OPENCODE_EXPERIMENTAL_HTTPAPI,这种情况下普通 Hono 路由不会被处理请求的那套 server 用到):
// packages/opencode/src/server/routes/instance/httpapi/groups/insight.ts(endpoint 定义)
// packages/opencode/src/server/routes/instance/httpapi/handlers/insight.ts(listFiles 实现)

import { directoryHeader } from "@/utils/headers"

export type InsightFileCategory = "uploads" | "outputs"

export interface InsightFileEntry {
  name: string
  path: string
  size: number
  mtime: number
}

// ── 文件类型分类(SPEC-INS-014 §10.1:类型筛选 / 类型分组用)────────────────
// 说明:服务端 listFiles 只回 name(见 handlers/insight.ts),类型由客户端按扩展名派生——
// worktree 文件类型比 Design 少,且文件名已过服务端;不为一个纯展示用的枚举再改一次
// 类型化 HttpApi(避免踩 hono-vs-effect-httpapi 那套坑)。分类口径与 icons/illustrations.ts
// 的 fileTypeIconUrl() 对齐(同一份扩展名清单派生 kind + 图标)。
export type InsightFileKind =
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

/** 按文件名扩展名派生 InsightFileKind(与 fileTypeIconUrl 同源)。 */
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

export function kindLabel(kind: InsightFileKind): string {
  return KIND_LABELS[kind]
}

export function kindSortPriority(kind: InsightFileKind): number {
  return KIND_PRIORITY[kind]
}

/** 服务端条目 + 客户端派生的 kind,供文件管理面板的分组 / 排序 / 筛选用。 */
export interface InsightFile extends InsightFileEntry {
  kind: InsightFileKind
}

export function toInsightFile(entry: InsightFileEntry): InsightFile {
  return { ...entry, kind: fileKind(entry.name) }
}

export async function fetchInsightFiles(
  sdkUrl: string,
  sdkDirectory: string,
  sessionId: string,
  category: InsightFileCategory,
): Promise<InsightFileEntry[]> {
  const params = new URLSearchParams({ sessionId, category })
  const res = await fetch(`${sdkUrl}/insight/files?${params.toString()}`, {
    headers: { ...directoryHeader(sdkDirectory) },
  })
  if (!res.ok) {
    console.error("[octo:insight-files] list-failed", { sessionId, category, status: res.status })
    throw new Error(`列出文件失败: ${res.statusText}`)
  }
  const data = (await res.json()) as { files: InsightFileEntry[] }
  console.log("[octo:insight-files] list-ok", { sessionId, category, count: data.files.length })
  return data.files
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
