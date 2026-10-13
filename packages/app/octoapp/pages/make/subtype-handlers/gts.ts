import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { ModelEditConfig, IconConfig, IconConfirmArgs } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig } from './default'
import { resolveRelativePath } from '../utils/history-store'
import { iconColors } from '../components/model-edit-items/icon-data/icon-colors'

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

export const gtsIconConfig: IconConfig = {
  getCustomIconDir: ({ sessionDir, filePath }) => {
    if (filePath) return `${filePath.replace(/[\\/][^\\/]+$/, '')}/uploads`
    return `${sessionDir}/.octo/${sessionDir}/assets`
  },
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
    styles: [
      { key: '线性', label: '线性', value: 'outline' },
      { key: '线性双色', label: '线性双色', value: 'two-tone' },
      { key: '方底托', label: '方底托', value: 'square' },
      { key: '圆底托', label: '圆底托', value: 'circle' },
    ],
    colors: iconColors,
    sizes: ['12', '14', '16', '20', '24', '32', '36', '40'],
    acceptedFileTypes: '.svg,.png,.jpg,.jpeg',
  },
  onConfirm: async ({ current, dom, filePath, writeFileBuffer, sessionDir }: IconConfirmArgs) => {
    let iconSrc = current.src ?? ''
    let iconFullPath = ''

    if (current.svgContent && writeFileBuffer && sessionDir) {
      const iconDir = filePath ? `${filePath.replace(/[\\/][^\\/]+$/, '')}/uploads/icons` : `${sessionDir}/.octo/${sessionDir}/assets`
      const safeName = (current.name ?? 'icon').replace(/[\\/:*?"<>|]/g, '_')
      const iconPath = `${iconDir}/icon_${safeName}.svg`
      try {
        await writeFileBuffer(iconPath, new TextEncoder().encode(current.svgContent).buffer as ArrayBuffer)
      } catch (e) {
        console.error('[icon] write SVG failed', iconPath, e)
      }
      iconSrc = `uploads/icons/icon_${safeName}.svg`
      iconFullPath = iconPath
    } else if (current.src) {
      iconSrc = current.src
      iconFullPath = filePath ? `${filePath.replace(/[\\/][^\\/]+$/, '')}/${current.src}` : current.src
    }

    const attrs = [
      `data-icon-name="${current.name ?? ''}"`,
      `data-icon-id="${current.id ?? ''}"`,
      `data-icon-custom="${current.isCustom ? 'true' : 'false'}"`,
      `data-icon-src="${iconSrc}"`,
      `data-icon-size="${current.size ?? ''}"`,
      `data-icon-style="${current.style ?? ''}"`,
      `data-icon-color="${current.color ?? ''}"`,
    ].join(' ')

    const lines: string[] = []
    lines.push(`[文件路径: ${filePath}]`)
    lines.push('')
    lines.push('请修改以下元素的图标:')
    lines.push(`标签: <${dom.tagName}>`)
    if (dom.className) lines.push(`类名: ${dom.className}`)
    lines.push(`选择器: ${dom.selector}（该元素可能是动态生成的）`)
    lines.push(`当前HTML: ${dom.htmlHint}`)
    lines.push('')
    lines.push('图标信息:')
    lines.push(`  名称: ${current.name}`)
    if (current.id) lines.push(`  ID: ${current.id}`)
    lines.push(`  文件路径: ${iconFullPath}`)
    lines.push(`  尺寸: ${current.size}`)
    lines.push(`  颜色: ${current.color}`)
    lines.push(`  形状: ${current.style}`)
    lines.push('')
    lines.push('请在对应元素上设置以下属性：')
    lines.push(`  ${attrs}`)

    return lines.join('\n')
  },
}

const gtsModelEditConfig: ModelEditConfig = {
  ...defaultModelEditConfig,
  iconConfig: gtsIconConfig,
}

const gtsHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'gts',
  modelEditConfig: gtsModelEditConfig,

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
}

export default gtsHandler
