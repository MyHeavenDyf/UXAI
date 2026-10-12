import type { SubtypeHandler } from './types'
import type { ModelEditConfig, IconConfig, IconConfirmArgs } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig } from './default'
import { iconColors } from '../components/model-edit-items/icon-data/icon-colors'

/**
 * demo 分支
 * 基于 _default 分支，增加新版局部编辑（modelEdit）功能，prompt 模式
 * 文件名格式：xxx.demo.html
 */

/**
 * 图标配置项（IconConfig）—— 提示词替换版本示例
 *
 * 由 IconModule 组件消费（components/model-edit-items/icon-module.tsx）：
 * - getCustomIconDir / getInitialState / data 仅决定选择器面板的目录、回显与可选项
 * - onConfirm 的返回值决定替换方式（组件 handleConfirm 统一分发）：
 *   · 返回 prompt 字符串 → 组件自动 sendTextToAgent 交给模型处理（提示词替换）
 *   · 返回空字符串      → 视为已在 onConfirm 内部完成直接替换
 *     （参考 default.ts：od:replace-element / od:edit-attr + 写回 HTML）
 */
export const demoIconConfig: IconConfig = {
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
  onConfirm: async ({ prev, current, dom, filePath, writeFileBuffer, sessionDir }: IconConfirmArgs) => {
    let iconSrc = current.src ?? ''

    // 1. 下载 SVG 到 uploads/icons/（在线/lucide 图标有 svgContent）。
    //    iconSrc：写入 data-icon-src 的相对路径；iconFullPath：绝对路径，仅供 prompt 描述使用。
    //    自定义上传没有 svgContent，走 else-if 分支沿用 current.src。
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

    // 2. 返回 prompt（不替换 DOM，不写回 HTML，由模型处理）。
    //    三段结构：目标文件与元素信息 / 图标信息 / 要求元素设置的 data-icon-* 属性串。
    //    返回后组件自动 sendTextToAgent，实际 DOM 与 HTML 修改由模型完成。
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
  selectionStyle: (dom) => {
    if (dom.elementKind === 'image') return { color: '#7c3aed', lineStyle: 'dashed' }
    if (dom.elementKind === 'link') return { color: '#ea580c' }
    return null
  },
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
