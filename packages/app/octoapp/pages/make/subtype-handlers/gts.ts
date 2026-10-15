import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { ModelEditConfig, AssetConfig } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig } from './default'
import JSZip from 'jszip'

/** 产物目录白名单：只收集这些顶层路径下的文件 */
const GTS_OUTPUT_DIRS = ['src', 'public']
/** 产物根级文件 */
const GTS_OUTPUT_FILES = ['index.gts.html', 'preview-data.js']

async function collectGtsProjectFiles(ctx: SubtypeHandlerContext): Promise<{ path: string; content: Uint8Array }[]> {
  const { tab, getDesktopApi } = ctx
  const api = getDesktopApi()
  if (!api?.readFileBuffer || !api?.listDirectory || !tab.filePath) return []

  const htmlDir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
  const entries = await api.listDirectory(htmlDir)

  const results: { path: string; content: Uint8Array }[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    const zipPath = entry.path.replace(/\\/g, '/')
    const topDir = zipPath.split('/')[0]

    const isOutputFile = GTS_OUTPUT_FILES.includes(zipPath)
    const isUnderOutputDir = GTS_OUTPUT_DIRS.includes(topDir)
    if (!isOutputFile && !isUnderOutputDir) continue

    const absPath = entry.path.startsWith('/') || entry.path.match(/^[A-Za-z]:/) ? entry.path : htmlDir + '/' + entry.path
    try {
      const buffer = await api.readFileBuffer!(absPath)
      if (buffer) results.push({ path: zipPath, content: new Uint8Array(buffer) })
    } catch {}
  }

  return results
}

export const gtsModelEditConfig: ModelEditConfig = {
  ...defaultModelEditConfig,
  assetConfig: {
    showConfig: () => true,
    getInitialState: () => ({ name: '未选择' }),
    onConfirm: ({ dom, filePath, folderpath }) => {
      return [
        `[文件: ${filePath}]`,
        `[选择器: ${dom.selector}（该元素可能是动态生成的）]`,
        `把当前的元素替换成 ${folderpath} 内页面的内容，不要使用Iframe。`,
      ].join('\n')
    },
  } satisfies AssetConfig,
}

const gtsHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'gts',
  modelEditConfig: gtsModelEditConfig,

  /** 历史记录入口 1：决定每次记录哪些文件。
   *  只记录 src/ 下的源码文件 + preview-data.js + index.gts.html，
   *  public/library/ 是固定 UMD 运行时，不需要历史快照。
   *  event.type: 'open' | 'edit' | 'agent-update' | 'agent-file-edit'
   *  返回相对路径数组；返回 null 表示本次不记录。
   *  agent-update 时跳过：tab 内容先于磁盘文件变化，recordVersion 会复制旧文件。
   *  open+isNew 的跳过由 onTabOpen 的 isSessionBusy 参数控制（session busy 时
   *  磁盘可能还是模板，跳过；session idle 时磁盘已是真实内容，记录）。 */
  async onHistoryTrigger(event, ctx) {
    if (event.type === 'agent-update') return null
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!api?.listDirectory || !tab.filePath) return ['./index.gts.html', './preview-data.js', './src']

    const dir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
    const entries = await api.listDirectory(dir)
    const rels = entries
      .filter(e => e.type === 'file')
      .map(e => e.path.replace(/\\/g, '/'))
      .filter(p => p.startsWith('src/') || GTS_OUTPUT_FILES.includes(p))
      .map(p => './' + p)

    return rels.length > 0 ? rels : ['./index.gts.html', './preview-data.js']
  },

  /** 历史记录入口 2：版本恢复逻辑。
   *  files 已携带 originalPath，直接逐个复制回原始路径。
   *  GTS 的 tab.filePath（index.gts.html）是 FIXED 文件，内容不变，
   *  但 preview-data.js 和 src/ 文件已更新，switchVersion 的
   *  setFilesRefreshKey 会 bump localUrl 的 ?v= 参数，触发 iframe reload。 */
  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !tab.filePath) return

    for (const f of files) {
      try {
        await api.copyFileTo(f.filePath, f.originalPath)
      } catch {}
    }
  },

  async handleDownload(ctx) {
    const { tab, showOctoToast, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!tab.filePath) {
      showOctoToast({ title: "无法获取文件路径" })
      return true
    }

    const files = await collectGtsProjectFiles(ctx)
    if (files.length === 0) {
      showOctoToast({ title: "暂无可下载的文件" })
      return true
    }

    const zip = new JSZip()
    for (const f of files) {
      zip.file(f.path, f.content)
    }
    const zipBlob = await zip.generateAsync({ type: "blob" })
    const zipName = `${tab.title.replace(/\.html?$/i, '')}.zip`

    if (api?.saveFilePicker && api?.writeFileBuffer) {
      const chosen = await api.saveFilePicker({ defaultPath: zipName })
      if (!chosen) return true
      const buffer = await zipBlob.arrayBuffer()
      await api.writeFileBuffer(chosen, buffer)
      showOctoToast({ title: "已下载" })
      return true
    }

    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement("a")
    a.href = url
    a.download = zipName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showOctoToast({ title: "已下载" })
    return true
  },

  async buildArchiveSrc(ctx) {
    const files = await collectGtsProjectFiles(ctx)
    if (files.length === 0) return null
    return { files }
  },
}

export default gtsHandler
