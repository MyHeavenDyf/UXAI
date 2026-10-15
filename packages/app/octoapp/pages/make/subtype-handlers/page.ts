import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { ModelEditConfig } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig, DownloadCancelledError } from './default'
import { showOctoToast, dismissOctoToast } from '../components/octo-toast'
import { setAgentExecution } from '../utils/page-utils/agent-execution-state'
import antdToEviewOrchestrator from '../../pattern/agents/antd-to-eview-orchestrator'
import JSZip from 'jszip'
import { createHistoryStore, fnv1aHash, relativePathToId, resolveRelativePath, getExt, VERSION_MANIFEST_FILE } from '../utils/history-store'

function wrapPagePrompt(filePath: string, body: string): string {
  const previewRoot = filePath.replace(/[/\\][^/\\]+$/, '')
  return [
    `预览页面源码根目录：${previewRoot}`,
    '请按下方信息在源代码中定位对应元素并修改。',
    '',
    body,
    '',
    '操作要求：',
    '1. 在源代码中定位对应元素',
    '2. 直接修改源代码中的样式和内容',
    '3. 修改完后执行编译操作',
  ].join('\n')
}

const pageModelEditConfig: ModelEditConfig = {
  saveCallback: async (args) => wrapPagePrompt(args.filePath, await defaultModelEditConfig.saveCallback(args)),
  deleteCallback: async (args) => wrapPagePrompt(args.filePath, await defaultModelEditConfig.deleteCallback(args)),
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

let downloading = false

const pageHandler = {
  ...defaultHandler,
  name: 'page',
  modelEditConfig: pageModelEditConfig,

  async handleDownload(ctx) {
    if (downloading) {
      ctx.showOctoToast({ title: '正在执行中，请等待完成' })
      return true
    }

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

    const loadingId = showOctoToast({ title: '正在运行编排 agent...', persistent: true })
    downloading = true
    try {
      const result = await antdToEviewOrchestrator({
        sdk: sdk!,
        sync,
        modelKey: modelKey!,
        rootSession: sessionId!,
        srcDirectory,
        onSessionCreated: (id: string) => {
          childSessionId = id
          setAgentExecution({ childSessionId: id, title: 'antd→eview 编排 Agent', visible: true })
        },
      })

      if (result.error) throw new Error(result.error)
      if (!childSessionId) throw new Error('Agent session not created')

      try {
        const zipBlob = await packOutputDir(ctx, outputDir)
        const zipName = `${tab.title.replace(/\.html?$/i, '')}-eview-react.zip`
        await downloadZipBlob(zipBlob, zipName, ctx)
      } finally {
        await sdk!.client.session.update({
          sessionID: childSessionId,
          body: { time: { archived: Date.now() } },
        }).catch(() => {})
      }

      setAgentExecution(null)
      dismissOctoToast(loadingId)
      showOctoToast({ title: '已下载' })
      return true
    } catch (e) {
      setAgentExecution(null)
      dismissOctoToast(loadingId)
      if (e instanceof DownloadCancelledError) throw e
      throw e
    } finally {
      downloading = false
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
