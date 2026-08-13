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
// jk-j60099994-replace-with-wx372822-pattern-topixso-1-start
// jk-j60099994-replace-with-wx372822-pattern-topixso-1-end

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
    if (!session.messageHandler) {
      session.messageHandler = createPrototypeMessageHandler(session)
      window.addEventListener("message", session.messageHandler)
    }
    const siblingMap = buildSiblingMap(await loadA2uiData(session, ctx))
    ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: true, siblingMap })
    return true
  },

  async handleCanvasEdit(ctx) {
    // 画布编辑：取当前 prototype 的 A2UI 数据（loadA2uiData 命中缓存时含未落盘的编辑，
    // 等价于 pattern 页的 pendingPreviewData()[sid]），连同 sessionId / title / projectSelection
    // 交给 transformerPipeline 做 A2UI → 设计稿转换。
    const tabId = ctx.tab.id
    setActiveSessionId(tabId)
    const session = getSessionById(tabId) ?? createSession(tabId, ctx)
    const previewData = await loadA2uiData(session, ctx)
    if (!previewData) {
      ctx.showToast({ title: "无法读取画布数据" })
      return true
    }

    const sessionId = ctx.tab.sessionId ?? ""
    // await transformerPipeline?.({
    //   previewData,
    //   sessionId,
    //   title: ctx.tab.title || sessionId || "export",
    //   projectSelection: ctx.projectSelection(),
    // })

    // jk-j60099994-replace-with-wx372822-pattern-topixso-2-start
    // jk-j60099994-replace-with-wx372822-pattern-topixso-2-end
    return true
  },
} satisfies SubtypeHandler
