import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import defaultHandler from './default'
import { resolveRelativePath } from '../utils/history-store'

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

const gtsHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'gts',

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
