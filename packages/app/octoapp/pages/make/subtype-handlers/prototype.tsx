import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import JSZip from "jszip"
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
import type { DesktopApi } from "../lib/electron-api"

let downloading = false

/**
 * 生成 prototype 代码包的文件列表 + uploads 目录信息。
 * 复用于 handleDownload（磁盘导出）和 buildArchiveSrc（内存 zip 塞进归档 src/）。
 *
 * 返回 null 表示软失败（无内容 / 环境不支持 / 缺参数），调用方应静默跳过。
 * 抛错表示生成过程中出错，调用方应捕获并提示。
 */
async function buildPrototypeCodeFiles(
  ctx: SubtypeHandlerContext,
  targetLib = 'eview-react',
  opts: { silent?: boolean } = {},
): Promise<{
  files: { path: string; content: string }[]
  uploadsDir?: string | null
} | null> {
  const toast = (msg: { title: string; description?: string }) => { if (!opts.silent) ctx.showToast(msg) }

  // 1. 读取 A2UI 数据（复用已有 session 或临时创建）
  const tabId = ctx.tab.id
  let session = getSessionById(tabId)
  if (!session) session = createSession(tabId, ctx)
  session.ctx = ctx

  const a2uiData = await loadA2uiData(session, ctx)
  if (!a2uiData) {
    toast({ title: "暂无可下载的内容" })
    return null
  }

  // 2. 检查 desktop API 可用性
  const desktopApi = ctx.getDesktopApi()
  if (!desktopApi?.downloadHuiCode) {
    toast({ title: "当前环境不支持代码导出" })
    return null
  }

  // 3. 检查 replanner 必需参数
  if (!ctx.sdk || !ctx.modelKey || !ctx.sessionId) {
    toast({ title: "缺少必要参数，无法生成代码" })
    return null
  }

  // 4. 调用 proto_replanner 重新生成 planner
  let planner: Record<string, unknown> | null = null
  let replannerSessionId: string | undefined
  try {
    const result = await proto_replanner({
      sdk: ctx.sdk!,
      sync: ctx.sync,
      modelKey: ctx.modelKey!,
      rootSession: ctx.sessionId!,
      finalA2UIJson: a2uiData as Record<string, unknown>,
      onSessionCreated: (childID: string) => { replannerSessionId = childID },
    })
    planner = result as unknown as Record<string, unknown>
  } finally {
    if (replannerSessionId) await ctx.sdk!.client.session.delete({ sessionID: replannerSessionId }).catch(() => {})
  }

  // 5. 调用 downloadHuiCode 生成代码文件
  const jsonInput = [{ planner: planner!, mergedA2UI: a2uiData as Record<string, unknown> }]
  const result = await desktopApi.downloadHuiCode!(jsonInput, { targetLib })
  const files = result?.files
  if (!files || files.length === 0) {
    toast({ title: "暂无可导出的代码" })
    return null
  }

  // 6. 获取 uploads 目录，供调用方决定是否打包资源
  const uploadsDir = await desktopApi.getUploadsDir?.()

  return { files, uploadsDir }
}

/** 递归列出目录下所有文件（绝对路径） */
async function listAllFiles(
  api: DesktopApi,
  dir: string,
): Promise<string[]> {
  if (!api.listDirectory) return []
  const entries = await api.listDirectory(dir)
  const out: string[] = []
  for (const e of entries) {
    if (e.type === 'file') {
      out.push(e.path)
    } else if (e.type === 'directory') {
      const nested = await listAllFiles(api, e.path)
      out.push(...nested)
    }
  }
  return out
}

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
    { value: 'eview-react', label: 'Eview-React' },
    { value: 'eview-ui', label: 'Eview UI' },
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
    const tabId = ctx.tab.id
    setActiveSessionId(tabId)
    const session = getSessionById(tabId) ?? createSession(tabId, ctx)
    const previewData = await loadA2uiData(session, ctx)
    if (!previewData) {
      ctx.showToast({ title: "无法读取画布数据" })
      return true
    }

    const sessionId = ctx.tab.sessionId ?? ""

    // jk-j60099994-replace-with-wx372822-pattern-topixso-2-start
    // jk-j60099994-replace-with-wx372822-pattern-topixso-2-end
    return true
  },
  
  async handleDownload(ctx, option) {
    if (downloading) return true
    downloading = true

    const targetLib = option ?? 'eview-react'
    // 磁盘导出还需要 exportZip 才能落盘
    const desktopApi = ctx.getDesktopApi()
    if (!desktopApi?.exportZip) {
      ctx.showToast({ title: "当前环境不支持代码导出" })
      downloading = false
      return true
    }

    try {
      const downloadPromise = (async () => {
        const result = await buildPrototypeCodeFiles(ctx, targetLib)
        if (!result) return null // 软失败已提示

        const { files, uploadsDir } = result
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

  /**
   * 归档钩子：构建等价于"下载"按钮产物的代码包 zip，塞进归档 zip 的 src/。
   * 用 JSZip 在内存构建，避免 exportZip 弹保存对话框打断归档流程。
   * 失败时返回 null，归档主流程会 toast "代码包生成失败，已跳过 src/"。
   */
  async buildArchiveSrc(ctx) {
    try {
      // silent: 归档路径自己处理 toast，不重复提示
      const result = await buildPrototypeCodeFiles(ctx, 'eview-react', { silent: true })
      if (!result) return null

      const desktopApi = ctx.getDesktopApi()
      const { files, uploadsDir } = result

      const zip = new JSZip()
      for (const f of files) {
        zip.file(f.path, f.content)
      }

      // 打包 uploads 资源到 public/assets，与 exportZip 的 sourceDir 行为对齐
      const fullUploadsPath = uploadsDir && ctx.sessionId
        ? `${uploadsDir}/${ctx.sessionId}/uploads`
        : null
      if (desktopApi && fullUploadsPath && desktopApi.listDirectory && desktopApi.readFileBuffer) {
        try {
          const allFiles = await listAllFiles(desktopApi, fullUploadsPath)
          for (const absPath of allFiles) {
            const rel = absPath.slice(fullUploadsPath.length).replace(/^[\\/]+/, '')
            const buffer = await desktopApi.readFileBuffer(absPath)
            if (buffer) zip.file(`public/assets/${rel}`, new Uint8Array(buffer))
          }
        } catch (err) {
          console.warn('[Archive] Failed to bundle uploads:', err)
        }
      }

      const blob = await zip.generateAsync({ type: "blob" })
      return { blob, fileName: 'code-export.zip' }
    } catch (err) {
      console.warn('[Archive] buildArchiveSrc failed:', err)
      return null
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
