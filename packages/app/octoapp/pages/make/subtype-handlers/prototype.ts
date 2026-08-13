import type { SubtypeHandler } from './types'
import {
  setActiveSessionId,
  getSessionById,
  createSession,
  disposeSession,
  createPrototypeMessageHandler,
  buildSiblingMap,
  loadA2uiData,
} from "../utils/prototype-utils"

export default {
  name: 'prototype',

  async handleLocalEdit(ctx) {
    const tabId = ctx.tab.id
    setActiveSessionId(tabId)
    let session = getSessionById(tabId)
    const next = !session?.editing
    ctx.postMessageToIframe?.({ type: "od:dom-picker-mode", enabled: next })
    if (!next) {
      ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: false })
      disposeSession(tabId)
      return true
    }
    if (!session) session = createSession(tabId, ctx)
    session.editing = true
    session.ctx = ctx
    // 先挂 message 监听再 await 加载 A2UI 数据，避免 iframe 在 await 窗口内回发的
    // od:a2ui-ready / od:dom-picker-quick-fix 等消息丢失。
    if (!session.messageHandler) {
      session.messageHandler = createPrototypeMessageHandler(session)
      window.addEventListener("message", session.messageHandler)
    }
    const siblingMap = buildSiblingMap(await loadA2uiData(session, ctx))
    ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: true, siblingMap })
    return true
  },
} satisfies SubtypeHandler
