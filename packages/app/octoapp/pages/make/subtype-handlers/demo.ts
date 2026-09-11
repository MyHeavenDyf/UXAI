import type { SubtypeHandler } from './types'
import type { ModelEditConfig, IconConfig, IconConfirmArgs } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig } from './default'
import { iconColors } from '../components/model-edit-items/icon-data/icon-colors'

/**
 * demo 分支
 * 基于 _default 分支，增加新版局部编辑（modelEdit）功能，prompt 模式
 * 文件名格式：xxx.demo.html
 */

const demoIconConfig: IconConfig = {
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
  onConfirm: async ({ prev, current, dom, filePath, writeFileBuffer, sessionDir }: IconConfirmArgs) => {
    let iconSrc = current.src ?? ''

    // 1. 下载 SVG 到 uploads/icons/（在线/lucide 图标有 svgContent）
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

    // 2. 返回 prompt（不替换 DOM，不写回 HTML，由模型处理）
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

const demoModelEditConfig: ModelEditConfig = {
  ...defaultModelEditConfig,
  promptCallback: (filePath, selector) => {
    return [
      `[文件: ${filePath}]`,
      `[选择器: ${selector}（该元素可能是动态生成的）]`,
    ].join('\n')
  },
  iconConfig: demoIconConfig,
}

const demoHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'demo',
  modelEditConfig: demoModelEditConfig,
}

export default demoHandler satisfies SubtypeHandler
