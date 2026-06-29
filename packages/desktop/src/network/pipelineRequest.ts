// 主进程 Pipeline 请求 — 使用 electron.net.fetch 直连后端(绕 CORS), 由 IPC handler 调用
import { net } from "electron"

export async function pipelineRequest(url: string, method: string, uiplusToken: string, body?: any, headers?: Record<string, string>): Promise<any> {
  const finalHeaders: Record<string, string> = { ...headers }
  if (uiplusToken) finalHeaders.uiplustoken = uiplusToken
  if (body) finalHeaders["content-type"] = "application/json"
  const res = await net.fetch(url, { method, headers: finalHeaders, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return await res.json()
}
