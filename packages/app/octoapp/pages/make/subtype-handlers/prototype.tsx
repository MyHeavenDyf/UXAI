import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import {
  setActiveSessionId,
  getSessionById,
  createSession,
  disposeSession,
  createPrototypeMessageHandler,
  buildSiblingMap,
  loadA2uiDocs,
  loadA2uiData,
  getA2uiDataRelativePaths,
  invalidatePrototypeCache,
} from "../utils/prototype-utils"
import { showPromiseToast } from "../components/octo-toast"
import proto_replanner from "../../pattern/agents/proto-replanner"
import type { DesktopApi } from "../lib/electron-api"
import { joinPath } from "../utils/references"

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
  opts: { silent?: boolean; planner?: Record<string, unknown> | null } = {},
): Promise<{
  files: { path: string; content: string }[]
  uploadsDir?: string | null
  /** prototype.html 同级 uploads 目录（make 侧属性编辑器上传的图片落点） */
  makeUploadsDir?: string | null
  /** 本次使用的 planner（供调用方复用给其他 targetLib，避免重复调 LLM） */
  planner: Record<string, unknown> | null
} | null> {
  const toast = (msg: { title: string; description?: string }) => { if (!opts.silent) ctx.showOctoToast(msg) }

  // 1. 读取 A2UI 数据（复用已有 session 或临时创建）
  const tabId = ctx.tab.id
  let session = getSessionById(tabId)
  if (!session) session = createSession(tabId, ctx)
  session.ctx = ctx

  const entries = await loadA2uiDocs(session, ctx)
  if (entries.length === 0) {
    toast({ title: "暂无可下载的内容" })
    return null
  }
  // 混合模式：a2ui-data 下有节点（entry.jsonPath 含 'a2ui-data'）。
  // 多节点时每个 doc 作为 jsonInput 一项（接口已兼容多份数据 → 导出一份合并代码），
  // 且无需 replanner 重新生成 planner。纯 A2UI 页（单 data.js）走原 replanner 流程。
  const isMixed = entries.some((e) => e.jsonPath.includes("a2ui-data"))

  // 2. 检查 desktop API 可用性
  const desktopApi = ctx.getDesktopApi()
  if (!desktopApi?.downloadHuiCode) {
    toast({ title: "当前环境不支持代码导出" })
    return null
  }

  // 4. planner：外部传入则复用；纯 A2UI 页且未提供时调 proto_replanner 生成。
  //    混合模式跳过 replanner（各节点 doc 直传 jsonInput 数组，无需重新生成 planner）。
  let planner: Record<string, unknown> | null = opts.planner ?? null
  if (!isMixed && !planner) {
    // replanner 必需参数
    if (!ctx.sdk || !ctx.modelKey || !ctx.sessionId) {
      toast({ title: "缺少必要参数，无法生成代码" })
      return null
    }
    let replannerSessionId: string | undefined
    try {
      const result = await proto_replanner({
        sdk: ctx.sdk!,
        sync: ctx.sync,
        modelKey: ctx.modelKey!,
        rootSession: ctx.sessionId!,
        finalA2UIJson: entries[0]!.doc as Record<string, unknown>,
        onSessionCreated: (childID: string) => { replannerSessionId = childID },
      })
      planner = result as unknown as Record<string, unknown>
    } finally {
      // 归档（而非 delete）临时子 session：session.list 默认排除 archived，
      // discoverChildSessions 不会发现它；即使归档失败，Fix（agent 过滤）也会跳过 proto_replanner
      if (replannerSessionId) await ctx.sdk!.client.session.update({
        sessionID: replannerSessionId,
        body: { time: { archived: Date.now() } },
      } as any).catch(() => {})
    }
  }

  // 5. 调用 downloadHuiCode 生成代码文件
  //    混合模式：每个 a2ui-data 节点 doc 作为 jsonInput 一项（接口已兼容多份数据 → 导出一份合并代码）。
  //    纯 A2UI 页：单条（mergedA2UI = data.js doc）。
  const plannerForInput = planner ?? ({"slots":[]} as Record<string, unknown>)
  const jsonInput = isMixed
    ? entries.map((e) => ({ planner: plannerForInput, mergedA2UI: e.doc as Record<string, unknown> }))
    : [{ planner: plannerForInput, mergedA2UI: entries[0]!.doc as Record<string, unknown> }]
  const result = await desktopApi.downloadHuiCode!(jsonInput, { targetLib })
  const files = result?.files
  if (!files || files.length === 0) {
    toast({ title: "暂无可导出的代码" })
    return null
  }

  // 6. 获取 uploads 目录，供调用方决定是否打包资源
  const uploadsDir = await desktopApi.getUploadsDir?.()

  // make 侧：prototype.html 同级 uploads 目录（属性编辑器上传图片落点，由 save-prototype-image IPC 写入）
  const htmlPath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  const makeUploadsDir = htmlPath ? htmlPath.replace(/[\\/][^\\/]+$/, '') + '/uploads' : null

  return { files, uploadsDir, makeUploadsDir, planner }
}

/** 列出目录下所有文件（绝对路径）。
 *  list-directory IPC 已递归 walk，返回的 path 是相对 dir 的相对路径，这里拼回绝对。 */
async function listAllFiles(
  api: DesktopApi,
  dir: string,
): Promise<string[]> {
  if (!api.listDirectory) return []
  const entries = await api.listDirectory(dir)
  return entries
    .filter(e => e.type === 'file')
    .map(e => joinPath(dir, e.path.replace(/\\/g, '/')))
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
    const siblingMap = buildSiblingMap(await loadA2uiDocs(session, ctx))
    ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: true, siblingMap })
    // 进入编辑态后请 iframe 把当前 surface 运行时 state 回传合并进 doc.state，
    // 避免首次 applyPrototypeModify 用磁盘旧 state 覆盖 iframe 内存态（modal 关闭等）。
    ctx.postMessageToIframe?.({ type: "od:a2ui-state-request" })
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
    ctx.showOctoToast({ title: "该功能未上线" })
    return true
  },

  async handleCanvasEdit(ctx) {
    const tabId = ctx.tab.id
    setActiveSessionId(tabId)
    const session = getSessionById(tabId) ?? createSession(tabId, ctx)
    const previewData = await loadA2uiData(session, ctx)
    if (!previewData) {
      ctx.showOctoToast({ title: "无法读取画布数据" })
      return true
    }

    const sessionId = ctx.sessionId ?? ""

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
      ctx.showOctoToast({ title: "当前环境不支持代码导出" })
      downloading = false
      return true
    }

    try {
      const downloadPromise = (async () => {
        const result = await buildPrototypeCodeFiles(ctx, targetLib)
        if (!result) return null // 软失败已提示

        const { files, uploadsDir, makeUploadsDir } = result
        const fullUploadsPath = uploadsDir && ctx.sessionId
          ? `${uploadsDir}/${ctx.sessionId}/uploads`
          : null

        // pattern 侧 + make 侧 uploads 都打到 public/assets（codegen 已把 uploads/... 改写为 /assets/...）
        const sourceDirs = [
          ...(fullUploadsPath ? [{ dir: fullUploadsPath, destFolder: "public/assets" }] : []),
          ...(makeUploadsDir ? [{ dir: makeUploadsDir, destFolder: "public/assets" }] : []),
        ]

        const zipPath = await desktopApi.exportZip!({
          defaultName: `code-export-${Date.now()}`,
          files,
          ...(sourceDirs.length ? { sourceDirs } : {}),
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
   * 失败时返回 null，归档主流程会 toast "代码包生成失败，已跳过 src/"。
   */
  async buildArchiveSrc(ctx) {
    try {
      // silent: 归档路径自己处理 toast，不重复提示
      // 先生成 eview-react 代码包并复用其 planner 给 eview-ui，省一次 LLM 调用
      const reactResult = await buildPrototypeCodeFiles(ctx, 'eview-react', { silent: true })
      if (!reactResult) return null

      const uiResult = await buildPrototypeCodeFiles(ctx, 'eview-ui', { silent: true, planner: reactResult.planner })
      if (!uiResult) ctx.showOctoToast({ title: "eview-ui 代码包生成失败，已跳过 eview-ui" })

      const out: { path: string; content: string | Uint8Array }[] = []
      // 两包并列子目录，避免根级文件冲突
      for (const f of reactResult.files) out.push({ path: `eview-react/${f.path}`, content: f.content })
      if (uiResult) for (const f of uiResult.files) out.push({ path: `eview-ui/${f.path}`, content: f.content })

      // 打包 pattern 侧 + make 侧 uploads 资源：每个代码包各自 public/assets/
      // codegen 已把 /uploads/... 和 uploads/... 改写为 /assets/...，故都落到各包 public/assets/
      const desktopApi = ctx.getDesktopApi()
      const { uploadsDir, makeUploadsDir } = reactResult
      const fullUploadsPath = uploadsDir && ctx.sessionId
        ? `${uploadsDir}/${ctx.sessionId}/uploads`
        : null
      const uploadDirs = [
        ...(fullUploadsPath ? [fullUploadsPath] : []),
        ...(makeUploadsDir ? [makeUploadsDir] : []),
      ]
      // uploads 同步写入每个成功的包
      const libs = uiResult ? ['eview-react', 'eview-ui'] : ['eview-react']
      if (desktopApi && desktopApi.listDirectory && desktopApi.readFileBuffer) {
        for (const dir of uploadDirs) {
          try {
            const allFiles = await listAllFiles(desktopApi, dir)
            for (const absPath of allFiles) {
              const rel = absPath.slice(dir.length).replace(/^[\\/]+/, '')
              const buffer = await desktopApi.readFileBuffer(absPath)
              if (!buffer) continue
              const bytes = new Uint8Array(buffer)
              for (const lib of libs) out.push({ path: `${lib}/public/assets/${rel}`, content: bytes })
            }
          } catch (err) {
            console.warn('[Archive] Failed to bundle uploads:', err)
          }
        }
      }

      return { files: out }
    } catch (err) {
      console.warn('[Archive] buildArchiveSrc failed:', err)
      return null
    }
  },

  /** 历史记录触发点：返回需快照的 A2UI 数据文件相对路径。
   *  混合页：解析 prototype.html 的 dataPath → a2ui-data 下各 .json（+ .data.js 孪生）；
   *  纯 A2UI 页：['./data.js']。HTML 自身不记（手写部分几乎不变，A2UI 数据承载全部用户编辑状态）。 */
  async onHistoryTrigger(_event, ctx) {
    return getA2uiDataRelativePaths(ctx)
  },

  /** 历史版本恢复：把版本里每个数据文件拷回原路径，并丢弃 a2ui 内存缓存，让 iframe 重载时重读。 */
  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !tab.filePath) return

    for (const f of files) {
      try {
        await api.copyFileTo(f.filePath, f.originalPath)
      } catch {
        // 版本里缺该文件时静默跳过
      }
    }

    // 失效内存中的 a2ui 缓存，下一次 loadA2uiDocs 会重读磁盘
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
