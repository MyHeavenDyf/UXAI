import type { SubtypeHandler } from './types'
import type { ModelEditConfig, IconConfig, IconConfirmArgs } from '../components/model-edit-items/types'
import gtsHandler, { gtsModelEditConfig } from './gts'
import { directModelEditConfig } from './default'

/**
 * GTS-EP 图标配置
 *
 * 基于 direct 模式(iframe 内 postMessage 实时预览),但做两处关键调整以适配 GTS 多文件结构:
 * 1. SVG 资源落盘到 public/icons/(GTS 产物白名单 src/public 之内,下载 ZIP 不断链),
 *    而非 direct 默认的 uploads/icons/(不在白名单内)。
 * 2. 不再调用 onContentChange 写回 index.gts.html —— 该文件是 FIXED 容器,写回会污染它
 *    (persistTabChanges 会 PUT tab.filePath=index.gts.html)。改为返回 prompt,
 *    icon-module 会用 sendTextToAgent 发给 agent,由 agent 修改 src/ 下的 Vue 源文件。
 *    postMessage 预览是临时的,agent 改完 Vue 源码后刷新才是持久化结果。
 */
const gtsEpIconConfig: IconConfig = {
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
        console.error('[gts-ep icon] write SVG failed', iconPath, e)
      }
      iconSrc = `public/icons/icon_${safeName}.svg`
    }

    // 2. iframe 内实时预览:postMessage 改运行时 DOM。刷新后会丢,持久化靠 step 3 的 agent 改 Vue 源码。
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

    // 3. 返回 prompt —— 不调用 onContentChange。icon-module 会把它发给 agent,
    //    由 agent 修改 src/ 下的 Vue 源文件,从而真正持久化(而非污染 index.gts.html)。
    const lines: string[] = []
    lines.push(`[文件: ${filePath}]`)
    lines.push(`[选择器: ${dom.selector}（该元素可能是动态生成的）]`)
    lines.push('这是一个 GTS 项目,index.gts.html 是固定容器,请修改 src/ 下对应的 Vue 源文件(如 src/pages/index.vue)把该元素替换成指定图标,不要使用 Iframe,不要改动 index.gts.html。')
    lines.push('')
    lines.push('目标元素 DOM 信息:')
    lines.push(`- 标签: <${dom.tagName}>`)
    if (dom.className) lines.push(`- 类名: ${dom.className}`)
    if (dom.htmlHint) lines.push(`- 元素片段: ${dom.htmlHint}`)
    lines.push('')
    lines.push('图标信息:')
    lines.push(`- 名称: ${current.name ?? '(无)'}`)
    lines.push(`- 尺寸: ${current.size ?? '24'}`)
    lines.push(`- 样式: ${current.style ?? 'outline'}`)
    lines.push(`- 颜色: ${current.color ?? '#191919'}`)
    if (iconSrc) lines.push(`- SVG 资源路径: ${iconSrc}（已写入磁盘,在 Vue 文件中用此相对路径引用）`)
    lines.push('')
    lines.push('修改要求:')
    lines.push(`- 把上述元素替换为图标${iconSrc ? `,使用图标资源 ${iconSrc}` : '(使用对应 lucide 图标)'}`)
    lines.push(`- 设置 data-icon-* 属性: ${Object.entries(iconAttrs).map(([k, v]) => `${k}="${v}"`).join(' ')}`)
    lines.push('- 修改后预览页面会自动刷新')
    return lines.join('\n')
  },
}

const gtsEpModelEditConfig: ModelEditConfig = {
  ...gtsModelEditConfig,
  iconConfig: gtsEpIconConfig,
}

const gtsEpHandler: SubtypeHandler = {
  ...gtsHandler,
  name: 'gts-ep',
  modelEditConfig: gtsEpModelEditConfig,
}

export default gtsEpHandler
