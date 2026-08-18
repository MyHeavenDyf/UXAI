import type { SubtypeHandlerContext } from "../../subtype-handlers/types"
import type { PrototypeSession } from "./types"
import { persistA2uiData } from "./a2ui"
import { dispatchPrototypeClosePanels } from "./events"

const sessions = new Map<string, PrototypeSession>()
let activeSessionId: string | null = null

export function getSession(): PrototypeSession | undefined {
  return activeSessionId ? sessions.get(activeSessionId) : undefined
}

export function getSessionById(tabId: string): PrototypeSession | undefined {
  return sessions.get(tabId)
}

export function setActiveSessionId(tabId: string) {
  activeSessionId = tabId
}

export function createSession(tabId: string, ctx: SubtypeHandlerContext): PrototypeSession {
  const session: PrototypeSession = {
    tabId,
    editing: false,
    ctx,
    messageHandler: null,
    a2ui: null,
    persistTimer: null,
    persistFilePath: null,
  }
  sessions.set(tabId, session)
  return session
}

export function disposeSession(tabId: string | null) {
  if (!tabId) return
  const session = sessions.get(tabId)
  if (!session) return
  if (session.persistTimer) {
    clearTimeout(session.persistTimer)
    session.persistTimer = null
    const fp = session.persistFilePath
    session.persistFilePath = null
    if (fp) void persistA2uiData(session, fp)
  }
  if (session.messageHandler) {
    window.removeEventListener("message", session.messageHandler)
    session.messageHandler = null
  }
  session.editing = false
  sessions.delete(tabId)
  if (activeSessionId === tabId) activeSessionId = null
}

export function isPrototypeEditing() {
  return getSession()?.editing ?? false
}

export function resetPrototypeEditing() {
  disposeSession(activeSessionId)
}

export function disposePrototypeSession(tabId: string) {
  disposeSession(tabId)
}

export function disposeAllPrototypeSessions() {
  for (const tabId of Array.from(sessions.keys())) disposeSession(tabId)
}

export function invalidatePrototypeCache(tabId: string) {
  const session = sessions.get(tabId)
  if (session) session.a2ui = null
}

/** 向当前 prototype iframe 发送 postMessage（用于「选择父容器」等动作） */
export function sendToPrototypeIframe(data: unknown) {
  getSession()?.ctx.postMessageToIframe?.(data)
}

/** 关闭所有 prototype 编辑浮层并解冻 iframe 内 DOM picker（清除选中标记，恢复可选状态） */
export function closePrototypePanels() {
  sendToPrototypeIframe({ type: "od:dom-picker-unfreeze" })
  dispatchPrototypeClosePanels()
}
