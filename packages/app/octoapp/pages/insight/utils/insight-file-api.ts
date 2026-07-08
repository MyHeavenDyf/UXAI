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
