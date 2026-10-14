import type { SubtypeHandler, SubtypeHandlerContext, LocalEditChange, LocalEditSavePayload } from './types'
import type { ModelEditConfig, AssetConfig } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig } from './default'
import { resolveRelativePath } from '../utils/history-store'
import { sendTextToAgent } from '../utils/agent-events'
import JSZip from 'jszip'

/** 固定文件集（不随产物变化），相对 tab.filePath 所在目录。 */
const GTS_STATIC_FILES = [
  '.',
  './preview-data.js',
  './src/main.js',
  './src/App.vue',
  './src/router/index.js',
  './src/locales/index.js',
  './src/locales/lang/zh-CN/common.json',
  './src/locales/lang/en-US/common.json',
  './src/assets/style/base.less',
  './src/assets/themes/base.css',
  './src/assets/tokens/index.css',
  './src/assets/icons/index.js',
]

/** 动态文件匹配规则（路径用正斜杠，相对产物根目录） */
const DYNAMIC_PATTERNS = [
  /^src\/views\/[^/]+\/index\.vue$/,
  /^src\/views\/[^/]+\/js\/[^/]+\.js$/,
  /^src\/api\/[^/]+\.js$/,
  /^mock\/modules\/[^/]+\.js$/,
  /^src\/locales\/pages\/[^/]+\.js$/,
  /^src\/assets\/icons\/[^/]+\.svg$/,
]

/** 动态发现产物特定文件（views/api/mock/locales-pages/icons-svg）。 */
async function discoverDynamicFiles(ctx: SubtypeHandlerContext): Promise<string[]> {
  const { tab, getDesktopApi } = ctx
  const api = getDesktopApi()
  if (!api?.listDirectory || !tab.filePath) return []

  const dir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
  const entries = await api.listDirectory(dir)

  return entries
    .filter(e => e.type === 'file')
    .map(e => e.path.replace(/\\/g, '/'))
    .filter(p => DYNAMIC_PATTERNS.some(re => re.test(p)))
    .map(p => './' + p)
}

function quote(value: string): string {
  return value ? `"${value}"` : '(空)'
}

function formatChange(change: LocalEditChange): string {
  switch (change.kind) {
    case 'text':
      return `修改文本：${quote(change.before)} → ${quote(change.after)}`
    case 'href':
      return `修改链接地址：${change.before || '(空)'} → ${change.after || '(空)'}`
    case 'styles':
      return change.changes
        .map((s) => `修改样式 ${s.prop}：${s.before || '(未设置)'} → ${s.after || '(清除)'}`)
        .join('\n')
    case 'remove-element':
      return '删除该元素'
    case 'image':
      return `修改图片：src → ${change.src}${change.alt ? `，alt → ${change.alt}` : ''}`
  }
}

async function collectGtsProjectFiles(ctx: SubtypeHandlerContext): Promise<{ path: string; content: Uint8Array }[]> {
  const { tab, getDesktopApi } = ctx
  const api = getDesktopApi()
  if (!api?.readFileBuffer || !tab.filePath) return []

  const dynamic = await discoverDynamicFiles(ctx)
  const allRels = [...GTS_STATIC_FILES, ...dynamic]
  const results: { path: string; content: Uint8Array }[] = []

  for (const rel of allRels) {
    const absPath = resolveRelativePath(rel, tab.filePath)
    try {
      const buffer = await api.readFileBuffer!(absPath)
      if (!buffer) continue
      const zipPath = rel === '.' || rel === './'
        ? tab.filePath.replace(/[\\/]/g, '/').split('/').pop() ?? 'index.html'
        : rel.replace(/^\.\//, '')
      results.push({ path: zipPath, content: new Uint8Array(buffer) })
    } catch {}
  }

  return results
}

const gtsModelEditConfig: ModelEditConfig = {
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

  async handleLocalEditSave(ctx) {
    const { tab, edit, showOctoToast } = ctx
    const target = edit.target
    const filePath = tab.filePath || tab.absoluteFilePath

    const lines: string[] = []
    lines.push(`请修改文件「${tab.title}」${filePath ? `（${filePath}）` : ''}。`)
    lines.push('这是一个 GTS 项目，需要修改对应的 Vue 文件（src/views/ 下的 index.vue 等）。')
    lines.push('')
    lines.push('页面中渲染出的目标元素 DOM 信息：')
    lines.push(`- 选择器：${target.selector || '(未知)'}`)
    lines.push(`- 标签：<${target.tagName}>`)
    if (target.className) lines.push(`- 类名：${target.className}`)
    if (target.text) lines.push(`- 当前文本：${target.text}`)
    lines.push(`- 位置与尺寸（bounding box）：x=${target.rect.x} y=${target.rect.y} w=${target.rect.width} h=${target.rect.height}`)
    if (target.htmlHint) lines.push(`- 元素片段：${target.htmlHint}`)
    const attrKeys = Object.keys(target.attributes || {})
    if (attrKeys.length > 0) {
      lines.push(`- 属性：${attrKeys.map((k) => `${k}="${target.attributes[k]}"`).join(' ')}`)
    }
    lines.push('')
    lines.push('需要做的变更：')
    for (const change of edit.changes) {
      lines.push(formatChange(change))
    }
    lines.push('')
    lines.push('请根据上述 DOM 信息找到对应的 Vue 文件并修改，修改后预览页面会自动刷新。')

    const result = await sendTextToAgent(lines.join('\n'), { source: 'local-edit' })
    if (result.ok) {
      showOctoToast({ title: '已提交修改请求' })
    } else {
      showOctoToast({ title: '提交失败', description: result.message ?? '请重试' })
    }
    return result.ok
  },

  /** 历史记录入口 1：决定每次记录哪些文件。
   *  固定文件 + 动态发现的产物特定文件。
   *  event.type: 'open' | 'edit' | 'agent-update' | 'agent-file-edit'
   *  返回相对路径数组；返回 null 表示本次不记录。
   *  agent-update 时跳过：tab 内容先于磁盘文件变化，recordVersion 会复制旧文件。
   *  open+isNew 的跳过由 onTabOpen 的 isSessionBusy 参数控制（session busy 时
   *  磁盘可能还是模板，跳过；session idle 时磁盘已是真实内容，记录）。 */
  async onHistoryTrigger(event, ctx) {
    if (event.type === 'agent-update') return null
    const dynamic = await discoverDynamicFiles(ctx)
    return [...GTS_STATIC_FILES, ...dynamic]
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
