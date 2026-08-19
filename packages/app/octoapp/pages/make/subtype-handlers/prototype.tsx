import type { SubtypeHandler } from './types'
import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import {
  setActiveSessionId,
  getSessionById,
  createSession,
  disposeSession,
  createPrototypeMessageHandler,
  buildSiblingMap,
  loadA2uiData,
  invalidatePrototypeCache,
} from "../utils/prototype-utils"
import { showPromiseToast } from "@opencode-ai/ui/toast"
import proto_replanner from "../../pattern/agents/proto-replanner"
import { relativePathToId, resolveRelativePath, getExt } from "../utils/history-store"

let downloading = false

const [isDarkTheme, setDarkTheme] = createSignal(false)

// iframe 每次加载/重载时会发 od:a2ui-ready，此时 iframe 内 isDark 已重置为 false。
// 同步重置本地 signal，避免 parent 与 iframe 状态不同步导致 toggle 方向反转。
window.addEventListener('message', (e) => {
  if ((e as MessageEvent).data?.type === 'od:a2ui-ready') setDarkTheme(false)
})

function mk(viewBox: string, inner: string, defaultSize: number) {
  return function Icon(props: { size?: number; class?: string }): JSX.Element {
    return (
      <svg
        viewBox={viewBox}
        width={props.size ?? defaultSize}
        height={props.size ?? defaultSize}
        fill="none"
        aria-hidden="true"
        class={props.class}
        style={{ "flex-shrink": "0", display: "inline-block" }}
        innerHTML={inner}
      />
    )
  }
}

const IconSun = mk("0 0 24 24", `
  <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
`, 16)

const IconMoon = mk("0 0 24 24", `
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
`, 16)

// jk-j60099994-replace-with-wx372822-pattern-topixso-1-start
// jk-j60099994-replace-with-wx372822-pattern-topixso-1-end

export default {
  name: 'prototype',

  downloadOptions: [
    { value: 'eview-react', label: 'eview-react' },
    { value: 'eview-ui', label: 'eview-ui' },
  ],

  async handleLocalEdit(ctx) {
    const tabId = ctx.tab.id
    setActiveSessionId(tabId)
    let session = getSessionById(tabId)
    const next = !session?.editing
    ctx.postMessageToIframe?.({ type: "od:dom-picker-mode", enabled: next })
    if (!next) {
      ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: false })
      disposeSession(tabId)
      return false
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
    return false
  },

  async handleLocalEditDisable(ctx) {
    const tabId = ctx.tab.id
    setActiveSessionId(tabId)
    ctx.postMessageToIframe?.({ type: "od:dom-picker-mode", enabled: false })
    ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: false })
    disposeSession(tabId)
  },

  async handleDrawEdit(ctx) {
    ctx.showToast({ title: "该功能未上线" })
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
  
  async handleDownload(ctx, option) {
    if (downloading) return true
    downloading = true

    const targetLib = option ?? 'eview-react'

    if (targetLib === 'eview-ui') {
      ctx.showToast({ title: 'eview-ui 暂未上线' })
      downloading = false
      return true
    }

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
        const result = await desktopApi.downloadHuiCode!(jsonInput, { targetLib })
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

  /** 历史记录触发点：只记录 data.js（HTML 几乎不变，A2UI 数据承载全部用户编辑状态）。 */
  onHistoryTrigger(_event, _ctx) {
    return ['./data.js']
  },

  /** 历史版本恢复：把版本里的 data.js 拷回原路径，并丢弃 a2ui 内存缓存，让 iframe 重载时重读。 */
  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !tab.filePath) return

    const rel = './data.js'
    const id = relativePathToId(rel)
    const originalPath = resolveRelativePath(rel, tab.filePath)
    const ext = getExt(originalPath)
    const versionFileName = id + ext
    const versionFile = files.find((f) => f.fileName === versionFileName)
    if (versionFile) {
      try {
        await api.copyFileTo(versionFile.filePath, originalPath)
      } catch {
        // 版本里缺 data.js 时静默跳过
      }
    }

    // 失效内存中的 a2ui 缓存，下一次 loadA2uiData 会重读磁盘
    invalidatePrototypeCache(tab.id)
  },

  components: {
    actionBar: {
      extraButtons: [
        {
          id: 'theme-toggle',
          label: () => isDarkTheme() ? '浅色' : '深色',
          icon: () => (isDarkTheme() ? IconSun : IconMoon)({ size: 16 }),
          position: 'before-comment',
          tooltip: () => isDarkTheme() ? '切换为浅色模式' : '切换为深色模式',
          active: false,
          onClick: (ctx) => {
            const next = !isDarkTheme()
            setDarkTheme(next)
            ctx.postMessageToIframe?.({ type: 'TOGGLE_THEME' })
          },
        },
      ],
    },
  },

} satisfies SubtypeHandler
