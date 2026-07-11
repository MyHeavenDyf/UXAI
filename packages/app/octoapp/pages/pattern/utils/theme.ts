/**
 * Theme Store — 设计系统主题的持久化
 * 每个会话首次发送时把选中的设计系统写入 <history>/<sessionId>/theme.json,
 * 切换回该会话时读取,用于恢复下拉选中状态(主题在首次发送后被锁定)。
 */

import { getDesktopApi } from "./desktop-api"

function themePath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/theme.json`
}

export async function saveTheme(dir: string, sessionId: string, theme: string): Promise<void> {
  const api = getDesktopApi()
  const path = themePath(dir, sessionId)
  const payload = JSON.stringify({ theme, createdAt: Date.now() }, null, 2)
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
  }
}

export async function loadTheme(dir: string, sessionId: string): Promise<string | null> {
  const api = getDesktopApi()
  const path = themePath(dir, sessionId)
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      const parsed = JSON.parse(new TextDecoder().decode(buf)) as { theme?: string }
      return typeof parsed.theme === "string" ? parsed.theme : null
    } catch {
      return null
    }
  }
  return null
}
