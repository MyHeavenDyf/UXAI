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
import { showPromiseToast } from "@opencode-ai/ui/toast"
import proto_replanner from "../../pattern/agents/proto-replanner"

let downloading = false

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
  
  async handleDownload(ctx) {
    if (downloading) return true
    downloading = true

    try {
      // 1. 读取 A2UI 数据（复用已有 session 或临时创建）
      const tabId = ctx.tab.id
      let session = getSessionById(tabId)
      if (!session) session = createSession(tabId, ctx)
      session.ctx = ctx

      const a2uiData = await loadA2uiData(session, ctx)
      if (!a2uiData) {
        ctx.showToast({ title: "暂无可下载的内容" })
        return true
      }

      // 2. 检查 desktop API 可用性
      const desktopApi = ctx.getDesktopApi()
      if (!desktopApi?.downloadHuiCode || !desktopApi?.exportZip) {
        ctx.showToast({ title: "当前环境不支持代码导出" })
        return true
      }

      // 3. 检查 replanner 必需参数
      if (!ctx.sdk || !ctx.modelKey || !ctx.sessionId) {
        ctx.showToast({ title: "缺少必要参数，无法生成代码" })
        return true
      }

      // 4-6. 用 showPromiseToast 持续显示进度，直到成功或失败
      const mergedA2UI = a2uiData as Record<string, unknown>

      const downloadPromise = (async () => {
        // 4. 调用 proto_replanner 重新生成 planner
        let planner: Record<string, unknown> | null = null
        let replannerSessionId: string | undefined
        try {
          const result = await proto_replanner({
            sdk: ctx.sdk!,
            sync: ctx.sync,
            modelKey: ctx.modelKey!,
            rootSession: ctx.sessionId!,
            finalA2UIJson: mergedA2UI,
            onSessionCreated: (childID: string) => { replannerSessionId = childID },
          })
          planner = result as unknown as Record<string, unknown>
        } finally {
          if (replannerSessionId) await ctx.sdk!.client.session.delete({ sessionID: replannerSessionId }).catch(() => {})
        }

        // 5. 调用 downloadHuiCode 生成代码文件
        const jsonInput = [{ planner: planner!, mergedA2UI }]
        const result = await desktopApi.downloadHuiCode!(jsonInput, { targetLib: 'eview-react' })
        const files = result?.files
        if (!files || files.length === 0) {
          throw new Error("暂无可导出的代码")
        }

        // 6. 获取 uploads 目录，打包资源
        const uploadsDir = await desktopApi.getUploadsDir?.()
        const fullUploadsPath = uploadsDir && ctx.sessionId
          ? `${uploadsDir}/${ctx.sessionId}/uploads`
          : null

        const zipPath = await desktopApi.exportZip!({
          defaultName: `code-export-${Date.now()}`,
          files,
          ...(fullUploadsPath
            ? { sourceDir: fullUploadsPath, destFolder: "public/assets" }
            : {}),
          comment: "a2ui-code",
        })

        return zipPath
      })()

      showPromiseToast(downloadPromise, {
        loading: "正在生成代码...",
        success: (zipPath: string | null) => zipPath ? "已导出压缩包" : "导出已取消",
        error: (err: unknown) => `代码生成失败: ${err instanceof Error ? err.message : String(err)}`,
      })

      try {
        await downloadPromise
      } catch {
        // showPromiseToast 已处理错误提示
      }
      return true
    } finally {
      downloading = false
    }
  },

  async handleComment(ctx) {
    ctx.showToast({ title: "该功能暂未上线" })
    return true
  },

  async handleArchive(ctx) {
    ctx.showToast({ title: "该功能暂未上线" })
    return true
  },

} satisfies SubtypeHandler
