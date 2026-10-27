import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { IconConfig, IconConfirmArgs, ModelEditConfig } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig, directModelEditConfig, DownloadCancelledError } from './default'

import { showOctoToast, dismissOctoToast } from '../components/octo-toast'
import { setAgentExecution } from '../utils/page-utils/agent-execution-state'
import antdToEviewOrchestrator from '../../pattern/agents/antd-to-eview-orchestrator'
import { createSignal, createRoot, createEffect } from 'solid-js'
import type { JSX } from 'solid-js'
import JSZip from 'jszip'
import { createHistoryStore, fnv1aHash, relativePathToId, resolveRelativePath, getExt, VERSION_MANIFEST_FILE } from '../utils/history-store'
import { iconColors } from '../components/model-edit-items/icon-data/icon-colors'

const [isDarkTheme, setDarkTheme] = createSignal(false)

window.addEventListener('message', (e) => {
  if ((e as MessageEvent).data?.type === 'od:components-theme-loaded') setDarkTheme(false)
})

function IconSun(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function IconMoon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function wrapPagePrompt(filePath: string, body: string): string {
  const previewRoot = filePath.replace(/[/\\][^/\\]+$/, '')
  return [
    `预览页面源码根目录：${previewRoot}`,
    '（本页面是通过ict-react-coder skill动态编译生成的）',
    '',
    body,
    '',
    '操作要求：',
    '1. 在源代码中定位对应元素',
    '2. 直接修改源代码中的样式和内容',
    '3. 修改完后执行编译操作',
  ].join('\n')
}

const SELECTOR_HINT = '该元素可能是动态生成的，修改时请识别真正源码路径'

function applySelectorHint(body: string): string {
  return body.split('（该元素可能是动态生成的）').join(SELECTOR_HINT ? `（${SELECTOR_HINT}）` : '')
}

const pageAssetConfig = directModelEditConfig.assetConfig!

/**
 * 图标配置项（IconConfig）—— 提示词替换版本示例
 * 提示词模式：onConfirm 返回完整图标改动 prompt，由模型改源码后重新编译
 */
const pageIconConfig: IconConfig = {
  // 自定义图标上传目录：HTML 同级 uploads/；无 filePath 时回退会话 assets 目录
  getCustomIconDir: ({ sessionDir, filePath }) => {
    if (filePath) return `${filePath.replace(/[\\/][^\\/]+$/, '')}/uploads`
    return `${sessionDir}/.octo/${sessionDir}/assets`
  },
  // 打开面板时从元素 data-icon-* 属性还原当前图标状态（回显）
  getInitialState: (dom) => ({
    name: dom.attributes['data-icon-name'] || '',
    id: dom.attributes['data-icon-id'] || '',
    isCustom: dom.attributes['data-icon-custom'] === 'true',
    size: dom.attributes['data-icon-size'] || '24',
    style: dom.attributes['data-icon-style'] || 'outline',
    color: dom.attributes['data-icon-color'] || '#191919',
    src: dom.attributes['data-icon-src'] || undefined,
  }),
  data: {
    // 形状选项：label 展示文案，value 写入 data-icon-style
    styles: [
      { key: '线性', label: '线性', value: 'outline' },
      { key: '线性双色', label: '线性双色', value: 'two-tone' },
      { key: '方底托', label: '方底托', value: 'square' },
      { key: '圆底托', label: '圆底托', value: 'circle' },
    ],
    // 语义色表：键为面板选色 key，twoColor/threeColor 供双色/三色图标配色
    colors: iconColors,
    // 尺寸快捷选项（px），写入 data-icon-size
    sizes: ['12', '14', '16', '20', '24', '32', '36', '40'],
    // 自定义上传允许的文件类型
    acceptedFileTypes: '.svg,.png,.jpg,.jpeg',
  },
  onConfirm: async ({ current, dom, filePath }: IconConfirmArgs) => {
    // 不下载 SVG、不替换 DOM——只把图标弹窗面板拿到的数据给 AI，
    // 由 AI 在源码中定位图标代码并改成目标数据；已有的 icon 组件会根据这些数据
    // 请求 SVG 并展示，无需前端下载替换。
    const lines: string[] = []
    lines.push(`[文件路径: ${filePath}]`)
    lines.push('')
    lines.push('请修改以下元素的图标:')
    lines.push(`标签: <${dom.tagName}>`)
    if (dom.className) lines.push(`类名: ${dom.className}`)
    lines.push(`选择器: ${dom.selector}（该元素可能是动态生成的）`)
    lines.push(`当前HTML: ${dom.htmlHint}`)
    lines.push('')
    lines.push('目标图标数据:')
    lines.push(`  名称: ${current.name ?? ''}`)
    lines.push(`  尺寸: ${current.size ?? ''}`)
    lines.push(`  颜色: ${current.color ?? ''}`)
    lines.push(`  形状: ${current.style ?? ''}`)
    lines.push(`  是否自定义: ${current.isCustom ? '是' : '否'}`)
    if (current.isCustom && current.src) lines.push(`  自定义路径: ${current.src}`)
    lines.push('')
    lines.push('请将该元素的图标代码修改为使用上述数据（已有 Icon 组件会根据这些数据请求 SVG 并展示，无需下载 SVG 进行替换）。')

    return lines.join('\n')
  },
}

const pageModelEditConfig: ModelEditConfig = {
  saveCallback: async (args) => wrapPagePrompt(args.filePath, applySelectorHint(await defaultModelEditConfig.saveCallback(args))),
  deleteCallback: async (args) => wrapPagePrompt(args.filePath, applySelectorHint(await defaultModelEditConfig.deleteCallback(args))),
  promptCallback: (filePath, selector) => [
    `[文件: ${filePath}（本页面是通过ict-react-coder skill动态编译生成的）]`,
    `[选择器: ${selector}${SELECTOR_HINT ? `（${SELECTOR_HINT}）` : ''}]`,
    `[用户需求]:`
  ].join('\n'),
  /** 选中 svg/img 时开放图标替换弹窗（与 demo/components 一致）；
   *  确认产生的 prompt 包上 page 专属指引（定位源码 + 编译），与 saveCallback/deleteCallback/assetConfig 的包装模式一致 */
  iconConfig: {
    ...pageIconConfig,
    onConfirm: async (args) => wrapPagePrompt(args.filePath, applySelectorHint(await pageIconConfig.onConfirm(args))),
  },
  /** 产品资产库：复用 default 的选择器/状态/下载逻辑，仅把确认 prompt 包上 page 专属指引
   *  （定位源码 + 编译），与 saveCallback/deleteCallback 的包装模式一致 */
  assetConfig: {
    ...pageAssetConfig,
    onConfirm: async (args) => wrapPagePrompt(args.filePath, applySelectorHint(await pageAssetConfig.onConfirm(args))),
  },
}

/** 纳入历史的源码文件扩展名（文本类；图片/字体等二进制资源不记录） */
const HISTORY_FILE_EXTS = ['.html', '.css', '.less', '.scss', '.sass', '.js', '.mjs', '.ts', '.jsx', '.tsx', '.vue', '.json']
/** 递归发现时排除的目录：.history（版本目录自身，纳入会无限递归记录）、
 *  node_modules/.git（依赖与元数据）、dist/build（编译产物，可由源码重新编译） */
const HISTORY_SKIP_DIRS = ['.history', 'node_modules', '.git', 'dist', 'build']
/** 单版本记录的文件数上限（防御异常庞大的产物目录） */
const HISTORY_MAX_FILES = 200

/** 动态发现预览根目录下的源码文件（相对路径，'./' 前缀）。
 *  page 产物目录结构由模型生成、不固定，无法像 gts 那样用固定清单，按扩展名白名单全量发现。
 *  listDirectory 已递归 walk，返回 path 相对所列目录。 */
async function discoverSourceFiles(ctx: SubtypeHandlerContext): Promise<string[]> {
  const { tab, getDesktopApi } = ctx
  const api = getDesktopApi()
  if (!api?.listDirectory || !tab.filePath) return []
  const selfName = tab.filePath.split(/[/\\]/).pop() ?? ''
  const dir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
  const entries = await api.listDirectory(dir)
  return entries
    .filter(e => e.type === 'file')
    .map(e => e.path.replace(/\\/g, '/'))
    .filter(p => p !== selfName)
    .filter(p => !HISTORY_SKIP_DIRS.some(d => p === d || p.startsWith(d + '/')))
    .filter(p => HISTORY_FILE_EXTS.some(ext => p.toLowerCase().endsWith(ext)))
    .sort()
    .slice(0, HISTORY_MAX_FILES)
    .map(p => './' + p)
}

/** 编译入口（index.page.html）内容是否与最新版本一致。
 *  page 的可见状态由编译产物定义：模型一轮编辑先改源码后编译，入口重写前的中间态
 *  不可见（点开与上一版本无差别），却会被 'turn' 的静默期结算/step 边界提前记成
 *  多余版本（表现为"同一时间两条记录，前一条无变化"）。
 *  入口未变时 onHistoryTrigger 返回 null：trigger 不记录；controller 的变更检测
 *  （getTabFiles ?? ["."]）同步退化为只盯入口，源码中间写入不再触发记录流程 */
async function entryUnchanged(ctx: SubtypeHandlerContext): Promise<boolean> {
  const { tab, getDesktopApi } = ctx
  const api = getDesktopApi()
  if (!api?.readFileBuffer || !tab.filePath) return false
  const newest = (await createHistoryStore().listVersions(tab))[0]
  if (!newest) return false
  const current = await api.readFileBuffer(tab.filePath)
  const recorded = await api.readFileBuffer(
    newest.folderPath + (newest.folderPath.includes('\\') ? '\\' : '/') + relativePathToId('.') + getExt(tab.filePath),
  )
  if (!current || !recorded) return false
  return fnv1aHash(current) === fnv1aHash(recorded)
}

async function packOutputDir(ctx: SubtypeHandlerContext, outputDir: string): Promise<Blob> {
  const api = ctx.getDesktopApi()
  if (!api?.listDirectory || !api?.readFileBuffer) throw new Error('当前环境不支持目录读取')

  const entries = (await api.listDirectory(outputDir)) ?? []
  const files = entries.filter(e => e.type === 'file')
  if (files.length === 0) throw new Error(`输出目录为空：${outputDir}`)

  const base = outputDir.replace(/[\\/]+$/, '')
  const zip = new JSZip()
  for (const entry of files) {
    const buf = await api.readFileBuffer!(`${base}/${entry.path}`)
    if (!buf) continue
    const relPath = entry.path.replace(/\\/g, '/')
    zip.file(relPath, new Uint8Array(buf))
  }
  return zip.generateAsync({ type: 'blob' })
}

function downloadZipBlob(blob: Blob, filename: string, ctx: SubtypeHandlerContext): Promise<void> {
  const api = ctx.getDesktopApi()
  if (api?.saveFilePicker && api?.writeFileBuffer) {
    return api.saveFilePicker({ defaultPath: filename }).then((chosen: string | null) => {
      if (!chosen) throw new DownloadCancelledError()
      return blob.arrayBuffer().then((buf: ArrayBuffer) => api.writeFileBuffer!(chosen, buf))
    })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return Promise.resolve()
}

/** 等待子 session 真正跑完（session_status 离开 busy/retry）。
 *  antd_to_eview_orchestrator 是多轮编排 agent，每轮都产出一条 completed 的
 *  assistant 消息，getResultFromMessages 会在首轮完成即返；用 session_status 兜底
 *  等整条流水线结束再继续归档/返回，避免内网偶发"agent 没跑完就往下走"。
 *  超时则放行（agent 仍可在后台继续，归档不会中断它）并返回 'timeout' 让调用方提示。
 *  返回 'idle' 表示 session_status 真正转闲；'timeout' 表示到达 timeoutMs 仍在忙。 */
function waitSessionIdle(
  sync: { data: { session_status?: Record<string, { type?: string } | undefined> } },
  sessionID: string,
  timeoutMs = 24 * 60 * 60 * 1000,
): Promise<'idle' | 'timeout'> {
  return new Promise<'idle' | 'timeout'>((resolve) => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (dispose: () => void, result: 'idle' | 'timeout') => {
      if (disposed) return
      disposed = true
      if (timer) clearTimeout(timer)
      dispose()
      resolve(result)
    }
    const dispose = createRoot((dispose) => {
      createEffect(() => {
        if (disposed) { dispose(); return }
        const status = sync?.data?.session_status?.[sessionID]
        const type = status?.type ?? 'idle'
        if (type === 'busy' || type === 'retry') return
        finish(dispose, 'idle')
      })
      return dispose
    })
    timer = setTimeout(() => finish(dispose, 'timeout'), timeoutMs)
  })
}

const downloadingTabs = new Set<string>()

const pageHandler = {
  ...defaultHandler,
  name: 'page',
  modelEditConfig: pageModelEditConfig,

  isDownloadBusy(ctx) {
    return downloadingTabs.has(ctx.tab.id)
  },

  async handleDownload(ctx) {
    if (downloadingTabs.has(ctx.tab.id)) return true

    const { tab, sdk, modelKey, sync, sessionId } = ctx

    if (!sdk || !modelKey || !sessionId) {
      ctx.showOctoToast({ title: '缺少必要参数，无法生成代码' })
      return true
    }

    const filePath = tab.filePath || tab.absoluteFilePath
    if (!filePath) {
      ctx.showOctoToast({ title: '无法获取文件路径' })
      return true
    }

    const srcDirectory = filePath.replace(/[/\\][^/\\]+$/, '')
    const outputDir = `${srcDirectory}-vite`
    let childSessionId: string | undefined

    // const loadingId = showOctoToast({ title: '正在运行编排 agent...', persistent: true })
    downloadingTabs.add(tab.id)
    try {
      const startTime = Date.now()
      const result = await antdToEviewOrchestrator({
        sdk: sdk!,
        sync,
        modelKey: modelKey!,
        rootSession: sessionId!,
        srcDirectory,
        onSessionCreated: (id: string) => {
          childSessionId = id
          // setAgentExecution(prev => ({ ...prev, [ctx.tab.id]: { childSessionId: id, title: 'antd→eview 编排 Agent', visible: true } }))
        },
      })

      if (result.error) throw new Error(result.error)
      if (!childSessionId) throw new Error('Agent session not created')

      // 编排 agent 多轮跑，getResultFromMessages 首轮即返；用 session_status 兜底等整条流水线结束再归档
      const idleState = await waitSessionIdle(sync, childSessionId)
      if (idleState === 'timeout') {
        ctx.showOctoToast({ title: '编排 Agent 运行超时（已超过 2 小时），建议检查运行状态' })
      }

      try {
        // const zipBlob = await packOutputDir(ctx, outputDir)
        // const zipName = `${tab.title.replace(/\.html?$/i, '')}-eview-react.zip`
        // await downloadZipBlob(zipBlob, zipName, ctx)
      } finally {
        await sdk!.client.session.update({
          sessionID: childSessionId,
          body: { time: { archived: Date.now() } },
        }).catch(() => {})
      }

      const elapsedMs = Date.now() - startTime
      const secs = Math.round(elapsedMs / 1000)
      const duration = secs < 60
        ? `${secs} 秒`
        : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`

      const msgResult = await sdk!.client.session.messages({ sessionID: childSessionId }).catch((err: unknown) => {
        console.warn('[antd→eview orchestrator] 获取消息失败:', err)
        return null
      })
      const msgItems = (msgResult?.data ?? []) as Array<{
        info: {
          role?: string
          agent?: string
          modelID?: string
          cost?: number
          tokens?: { input?: number; output?: number }
          time?: { created?: number; completed?: number }
        }
        parts: unknown[]
      }>
      const assistantMsgs = msgItems.filter(item => item.info.role === 'assistant')
      const totalCost = assistantMsgs.reduce((sum, item) => sum + (item.info.cost ?? 0), 0)
      const totalTokens = assistantMsgs.reduce((sum, item) => sum + ((item.info.tokens?.input ?? 0) + (item.info.tokens?.output ?? 0)), 0)

      console.log('[antd→eview orchestrator] 消息记录:', {
        childSessionId,
        messageCount: msgItems.length,
        duration,
        totalCost,
        totalTokens,
        messages: msgItems.map(item => ({
          role: item.info.role,
          agent: item.info.agent,
          model: item.info.modelID,
          time: item.info.time,
          cost: item.info.cost,
          tokens: item.info.tokens,
          partCount: item.parts.length,
        })),
      })
      console.log('[antd→eview orchestrator] 完整消息:', msgItems)

      const desktopApi = ctx.getDesktopApi()
      if (desktopApi?.writeFileBuffer) {
        const debugPath = `${sdk!.directory}/.octo/${sessionId}/debug-log/orchestrator-${childSessionId}.json`
        const payload = JSON.stringify({
          childSessionId,
          rootSessionId: sessionId,
          savedAt: Date.now(),
          duration,
          totalCost,
          totalTokens,
          messages: msgItems,
        }, null, 2)
        await desktopApi.writeFileBuffer(debugPath, new TextEncoder().encode(payload).buffer).then(
          () => console.log('[antd→eview orchestrator] 消息已保存至:', debugPath),
          (err: unknown) => console.warn('[antd→eview orchestrator] 消息持久化失败:', err),
        )
      }

      const tokensStr = totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : `${totalTokens}`
      const costStr = totalCost > 0 ? ` · $${totalCost.toFixed(2)}` : ''

      setAgentExecution(prev => { const next = { ...prev }; delete next[ctx.tab.id]; return next })
      // dismissOctoToast(loadingId)
      ctx.showOctoToast({
        title: '编排完成',
        description: `耗时 ${duration} · 上下文 ${tokensStr} tokens${costStr}`,
      })
      return true
    } catch (e) {
      setAgentExecution(prev => { const next = { ...prev }; delete next[ctx.tab.id]; return next })
      // dismissOctoToast(loadingId)
      if (e instanceof DownloadCancelledError) throw e
      throw e
    } finally {
      downloadingTabs.delete(tab.id)
    }
  },
  components: {
    actionBar: {
      extraButtons: [
        {
          id: 'theme-toggle',
          label: () => isDarkTheme() ? '浅色' : '深色',
          icon: () => isDarkTheme() ? <IconSun /> : <IconMoon />,
          position: 'before-comment',
          tooltip: () => isDarkTheme() ? '切换为浅色模式' : '切换为深色模式',
          onClick: (ctx) => {
            const next = !isDarkTheme()
            setDarkTheme(next)
            ctx.postMessageToIframe?.({ type: 'od:toggle-theme' })
          },
        },
      ],
    },
  },

  async buildArchiveSrc(ctx) {
    try {
      const api = ctx.getDesktopApi()
      if (!api?.listDirectory || !api?.readFileBuffer) return null
      const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
      if (!filePath) return null
      const codeDir = `${filePath.replace(/[/\\][^/\\]+$/, '')}-eview-react`

      const listFiles = async () =>
        ((await api.listDirectory!(codeDir)) ?? []).filter(e => e.type === 'file')

      let files = await listFiles()
      if (files.length === 0) {
        ctx.showOctoToast({ title: '代码包尚未生成，正在触发下载流程...' })
        await pageHandler.handleDownload(ctx)
        files = await listFiles()
      }
      if (files.length === 0) return null

      const skipFiles = new Set(['.umd-conversion.json', '.conversion-result.json', '.migration-result.json', '.icon-result.json', '.npmrc', 'package-lock.json'])
      const out: { path: string; content: Uint8Array }[] = []
      for (const entry of files) {
        const rel = entry.path.replace(/\\/g, '/')
        if (rel.startsWith('node_modules/') || rel.startsWith('.history/')) continue
        if (skipFiles.has(rel)) continue
        const buf = await api.readFileBuffer(`${codeDir}/${rel}`)
        if (buf) out.push({ path: `download-eview-react/${rel}`, content: new Uint8Array(buf) })
      }
      return { files: out }
    } catch (err) {
      console.warn('[Archive] buildArchiveSrc failed:', err)
      return null
    }
  },

  /** 历史记录入口 1：'.'（index.page.html 自身）+ 动态发现的源码文件（样式/脚本等）。
   *  agent-update 跳过：tab 内容先于磁盘文件变化，此时快照会复制到旧文件（同 gts）。
   *  edit/agent-file-edit 时入口未变则返回 null：中间态不产生版本（见 entryUnchanged）；
   *  open 事件不做该过滤（switchVersion 用它取恢复清单，返回 null 会导致无法还原） */
  async onHistoryTrigger(event, ctx) {
    if (event.type === 'agent-update') return null
    if ((event.type === 'edit' || event.type === 'agent-file-edit') && await entryUnchanged(ctx)) return null
    return ['.', ...(await discoverSourceFiles(ctx))]
  },

  /** 历史记录入口 2：把版本内每个文件拷回原路径，并同步 tab 内容（HTML 自身可能变化）。
   *  参照 components 的「记录什么就恢复什么」：优先按版本目录内的 __manifest.json
   *  （快照时的完整文件清单）还原——记录之后被删除的文件也能恢复回来；
   *  无清单的旧版本回退到 files（由当前目录发现结果 ∩ 版本内容交集而来） */
  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi, updateTabContent } = ctx
    const api = getDesktopApi()
    const versionDir = files[0]?.filePath.replace(/[/\\][^/\\]+$/, '')
    if (!api?.copyFileTo || !api?.readFileBuffer || !tab.filePath || !versionDir) return

    const sep = versionDir.includes('\\') ? '\\' : '/'
    const rels = (await readVersionManifest(api.readFileBuffer, versionDir)) ?? files.map(f => f.relativePath)

    for (const rel of rels) {
      const dest = resolveRelativePath(rel, tab.filePath)
      try {
        await api.copyFileTo(versionDir + sep + relativePathToId(rel) + getExt(dest), dest)
      } catch {
        // 版本里缺该文件（快照时复制失败）时静默跳过
      }
    }

    const buf = await api.readFileBuffer(tab.filePath)
    if (buf && updateTabContent) {
      updateTabContent(tab.id, new TextDecoder().decode(buf))
    }
  },
} satisfies SubtypeHandler

export default pageHandler

/** 读版本目录内的快照文件清单；不存在/损坏返回 null（走回退路径） */
async function readVersionManifest(
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>,
  versionDir: string,
): Promise<string[] | null> {
  try {
    const buf = await readFileBuffer(versionDir + (versionDir.includes('\\') ? '\\' : '/') + VERSION_MANIFEST_FILE)
    if (!buf) return null
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as { files?: unknown }
    return Array.isArray(parsed.files) && parsed.files.every(f => typeof f === 'string') ? parsed.files as string[] : null
  } catch {
    return null
  }
}

