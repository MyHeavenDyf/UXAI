import { getDesktopApi } from "./desktop-api"

export function classifyAIError(err: unknown): { title: string; description: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === "aborted") return { title: "", description: "" }
  if (msg.includes("ProviderAuthError") || msg.includes("401") || msg.includes("403") || msg.includes("unauthorized"))
    return { title: "认证失败", description: "API Key 无效或已过期，请检查模型配置" }
  if (msg.includes("token") || msg.includes("ContextOverflowError") || msg.includes("MessageOutputLengthError"))
    return { title: "Token 超限", description: "上下文长度超出模型限制，请尝试简化输入内容" }
  if (msg.includes("APIError") || msg.includes("fetch") || msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("timeout"))
    return { title: "网络错误", description: "网络连接异常，请检查网络后重试" }
  if (msg.includes("not return valid JSON") || msg.includes("SyntaxError") || msg.includes("Unexpected token") || msg.includes("JSON.parse"))
    return { title: "JSON 解析失败", description: "AI 返回的 Json 数据格式异常，请重试" }
  if (msg.includes("element_id") || msg.includes("rootId") || msg.includes("Planner"))
    return { title: "生成异常", description: "AI 生成的组件 ID 不一致，请尝试重新生成" }
  if (msg.includes("Failed to create session") || msg.includes("Failed to get") || msg.includes("session"))
    return { title: "会话异常", description: "Session 创建或获取失败，请重试" }
  return { title: "生成失败", description: msg.length > 150 ? msg.slice(0, 150) + "..." : msg }
}

function errorFilePath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/proto_error.json`
}

export async function saveProtoError(dir: string, sessionId: string, errorTitle: string): Promise<void> {
  const api = getDesktopApi()
  const path = errorFilePath(dir, sessionId)
  const payload = JSON.stringify({ error: errorTitle, createdAt: Date.now() })
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
  }
}

export async function loadProtoError(dir: string, sessionId: string): Promise<string | null> {
  const api = getDesktopApi()
  const path = errorFilePath(dir, sessionId)
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      const data = JSON.parse(new TextDecoder().decode(buf))
      return data.error ?? null
    } catch {
      return null
    }
  }
  return null
}

export async function clearProtoError(dir: string, sessionId: string): Promise<void> {
  const api = getDesktopApi()
  const path = errorFilePath(dir, sessionId)
  if (api?.deleteFile) {
    await api.deleteFile(path).catch(() => {})
  }
}
