import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { ModelEditConfig, AssetConfig, IconConfig, IconConfirmArgs, SaveCallbackArgs, DeleteCallbackArgs } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig, directModelEditConfig } from './default'
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

// GTS 源码定位 prompt 包装（参照 components.tsx 的 wrapComponentsPrompt）
// 不依赖 DOM 组件标记 — 点击元素走 native 分支,拿到标签/类名/选择器后,
// 用提示词告诉 agent: 这是 GTS (Vue 3 + SweetUI) 项目,源码在 src/pages 下的 index.vue,
// 按类名/选择器在 .vue 文件里定位对应元素,改完重跑 build.mjs 刷新预览。
// index.gts.html 是 FIXED 容器,不可直接编辑。
function wrapGtsPrompt(filePath: string, body: string): string {
  const previewRoot = filePath.replace(/[/\\][^/\\]+$/, '')
  return [
    `预览页面源码根目录：${previewRoot}`,
    '该预览由 sweetui-vue-creator skill 的 build.mjs 编译生成，index.gts.html 是编译产物，不可直接编辑。',
    '真正的源码在 src/pages/{页面名}/index.vue 中（Vue 3 + SweetUI SFC，由 vue3-sfc-loader 在浏览器现场编译渲染）。',
    '请按下方信息定位源码、应用变更，然后重新编译并验证。',
    '',
    body,
    '',
    '操作要求：',
    '1. 按类名/选择器在 src/pages 下各 index.vue 的 <template> 中定位对应元素，修改结构或文本',
    '2. 样式改对应 .vue 的 <style scoped lang="less">，颜色/间距用 design token（var(--color-*) / var(--space-size-*)）',
    '3. 只改 src/ 下的源码文件，不要改 index.gts.html',
    `4. 重新编译：node scripts/build.mjs --dir "${previewRoot}"`,
    '5. build 产物 preview-data.js 更新后预览会自动刷新',
  ].join('\n')
}

// GTS 图标配置工厂 — 封装 SVG 落盘到 public/icons + postMessage 实时预览 + 返回 prompt 包装。
// gts 和 gts-ep 共用此逻辑,仅 wrapPrompt 不同(各自的源码定位提示词)。
// 不调用 onContentChange 写回 index.gts.html(FIXED 容器),改由 agent 改 src/ 下 Vue 源码后 rebuild 持久化。
export function createGtsIconConfig(wrapPrompt: (filePath: string, body: string) => string): IconConfig {
  return {
    ...directModelEditConfig.iconConfig,
    getCustomIconDir: ({ sessionDir, filePath }) => {
      if (filePath) return `${filePath.replace(/[\\/][^\\/]+$/, '')}/public/icons`
      return `${sessionDir}/.octo/${sessionDir}/assets`
    },
    onConfirm: async ({ current, dom, filePath, postMessageToIframe, writeFileBuffer }: IconConfirmArgs) => {
      const id = dom.dataOdId
      const tag = dom.tagName
      let iconSrc = current.src ?? ''

      // 1. 在线/自定义图标的 SVG 落盘到 public/icons/(GTS 静态资源目录,在产物白名单内)
      if (current.svgContent && writeFileBuffer && filePath) {
        const iconDir = `${filePath.replace(/[\\/][^\\/]+$/, '')}/public/icons`
        const safeName = (current.name ?? 'icon').replace(/[\\/:*?"<>|]/g, '_')
        const iconPath = `${iconDir}/icon_${safeName}.svg`
        try {
          await writeFileBuffer(iconPath, new TextEncoder().encode(current.svgContent).buffer as ArrayBuffer)
        } catch (e) {
          console.error('[gts icon] write SVG failed', iconPath, e)
        }
        iconSrc = `public/icons/icon_${safeName}.svg`
      }

      // 2. iframe 内实时预览:postMessage 改运行时 DOM。刷新后会丢,持久化靠 step 3 的 agent 改 Vue 源码后 rebuild。
      const iconAttrs: Record<string, string> = {
        'data-icon-name': current.name ?? '',
        'data-icon-id': current.id ?? '',
        'data-icon-custom': current.isCustom ? 'true' : 'false',
        'data-icon-src': iconSrc,
        'data-icon-size': current.size ?? '',
        'data-icon-style': current.style ?? '',
        'data-icon-color': current.color ?? '',
      }
      if (tag === 'img') {
        if (iconSrc) postMessageToIframe({ type: 'od:edit-attr', elementId: id, attr: 'src', value: iconSrc })
        for (const [k, v] of Object.entries(iconAttrs)) {
          postMessageToIframe({ type: 'od:edit-attr', elementId: id, attr: k, value: v })
        }
      } else if (tag === 'svg') {
        const html = current.isCustom || !current.svgContent
          ? `<img src="${iconSrc}" width="${current.size ?? 24}" height="${current.size ?? 24}" />`
          : current.svgContent
        postMessageToIframe({ type: 'od:replace-element', elementId: id, html, attrs: iconAttrs })
      }

      // 3. 返回 prompt — 不调用 onContentChange。icon-module 会把它发给 agent,
      //    由 agent 修改 src/ 下的 Vue 源文件,从而真正持久化(而非污染 index.gts.html)。
      const body: string[] = []
      body.push('目标元素 DOM 信息:')
      body.push(`- 标签: <${dom.tagName}>`)
      if (dom.className) body.push(`- 类名: ${dom.className}`)
      if (dom.selector) body.push(`- 选择器: ${dom.selector}（该元素可能是动态生成的）`)
      if (dom.htmlHint) body.push(`- 元素片段: ${dom.htmlHint}`)
      body.push('')
      body.push('图标信息:')
      body.push(`- 名称: ${current.name ?? '(无)'}`)
      body.push(`- 尺寸: ${current.size ?? '24'}`)
      body.push(`- 样式: ${current.style ?? 'outline'}`)
      body.push(`- 颜色: ${current.color ?? '#191919'}`)
      if (iconSrc) body.push(`- SVG 资源路径: ${iconSrc}（已写入磁盘,在 Vue 文件中用此相对路径引用）`)
      body.push('')
      body.push('修改要求:')
      body.push(`- 把上述元素替换为图标${iconSrc ? `,使用图标资源 ${iconSrc}` : '(使用对应 Element Plus 图标)'}`)
      body.push(`- 设置 data-icon-* 属性: ${Object.entries(iconAttrs).map(([k, v]) => `${k}="${v}"`).join(' ')}`)
      return wrapPrompt(filePath, body.join('\n'))
    },
  }
}

export const gtsModelEditConfig: ModelEditConfig = {
  ...defaultModelEditConfig,
  saveCallback: async (args: SaveCallbackArgs) => wrapGtsPrompt(args.filePath, await defaultModelEditConfig.saveCallback(args)),
  deleteCallback: async (args: DeleteCallbackArgs) => wrapGtsPrompt(args.filePath, await defaultModelEditConfig.deleteCallback(args)),
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
