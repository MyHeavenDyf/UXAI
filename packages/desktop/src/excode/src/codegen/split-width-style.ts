/**
 * split-width-style — 从 className 拆分宽度类，转为内联样式对象 / iconSize 数字
 *
 * 供各组件映射（Input → inputStyle, Select → selectStyle 等）复用。
 * 宽度类（w-47, w-[226px] 等）通过 convertTailwindToCSS 转为
 * { width: '188px' } 这样的 camelCase 对象，直接写入目标组件的
 * style prop（inputStyle / selectStyle / stickStyle / timeStyle）。
 *
 * 内联 style 优先级高于 CSS class，无需 !important。
 *
 * extractIconSizeFromClassName：从 className 中提取宽度类并转为 iconSize
 * 像素数字（供 Icon 组件映射使用，@nce/icon-plus 的 iconSize prop）。
 * className 保持原样，仅额外提取 iconSize。
 */

import { convertTailwindToCSS } from './tailwind-converter'

// ─── 宽度类正则：匹配 w-xxx, w-[xxx], !w-xxx, !w-[xxx] ───
const WIDTH_CLASS_RE = /^!?w-/

// ─── 公共接口 ───

export interface SplitWidthResult {
  /** 剩余非宽度类（保留在 className） */
  className: string | null
  /** 宽度样式对象（写入 inputStyle / selectStyle / stickStyle / timeStyle） */
  widthStyle: Record<string, string> | null
}

/**
 * 从 className 拆分宽度类，并用 convertTailwindToCSS 转为内联样式对象。
 *
 * - 宽度类（w-47, w-[226px] 等）→ widthStyle 对象
 * - 其余类 → 保留在 className
 * - 非字符串 / 空字符串 → 原样返回 null
 */
export function splitWidthToStyle(className: string | undefined): SplitWidthResult {
  if (!className || typeof className !== 'string' || !className.trim()) {
    return { className: null, widthStyle: null }
  }

  const tokens = className.split(/\s+/).filter(Boolean)
  const widthTokens: string[] = []
  const otherTokens: string[] = []

  for (const token of tokens) {
    if (WIDTH_CLASS_RE.test(token)) {
      widthTokens.push(token)
    } else {
      otherTokens.push(token)
    }
  }

  const cn = otherTokens.length > 0 ? otherTokens.join(' ') : null

  if (widthTokens.length === 0) {
    return { className: cn, widthStyle: null }
  }

  // convertTailwindToCSS 已在模块级初始化，返回 { width: '188px' } 等 camelCase 对象
  // useVar=false：内联 style 不支持 var()，直接解析为具体值
  const styleObj = convertTailwindToCSS(widthTokens.join(' '), false)

  // 只取有值的属性（过滤掉解析失败的）
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(styleObj)) {
    if (v) filtered[k] = v
  }

  return {
    className: cn,
    widthStyle: Object.keys(filtered).length > 0 ? filtered : null,
  }
}

// ─── Icon iconSize 提取 ───

export interface ExtractIconSizeResult {
  /** 从 w-xx 类解析出的像素尺寸（如 20），无宽度类时为 null */
  iconSize: number | null
}

/**
 * 从 className 中提取宽度类并转为 iconSize 像素数字。
 *
 * 用于 Icon 组件映射：A2UI 的 Icon 通过 className 的 w-xx/h-xx 传递尺寸，
 * 目标 @nce/icon-plus 组件还需要 iconSize 数字 prop 控制尺寸。
 * className 保持原样，仅额外提取 iconSize。
 *
 * 使用 convertTailwindToCSS 解析（处理项目自定义 Tailwind 配置，
 * 如 w-47 等非标准间距）。
 */
export function extractIconSizeFromClassName(className: string | undefined): ExtractIconSizeResult {
  if (!className || typeof className !== 'string' || !className.trim()) {
    return { iconSize: null }
  }

  const tokens = className.split(/\s+/).filter(Boolean)
  const widthTokens: string[] = []

  for (const token of tokens) {
    if (WIDTH_CLASS_RE.test(token)) {
      widthTokens.push(token)
    }
  }

  if (widthTokens.length === 0) {
    return { iconSize: null }
  }

  // convertTailwindToCSS 已在模块级初始化，返回 { width: '20px' } 等 camelCase 对象
  // useVar=false：直接解析为具体像素值
  const styleObj = convertTailwindToCSS(widthTokens.join(' '), false)

  const widthValue = styleObj.width
  if (!widthValue) {
    return { iconSize: null }
  }

  // 从 "20px" 提取数字
  const pxMatch = widthValue.match(/^(\d+(?:\.\d+)?)px$/)
  if (!pxMatch) {
    return { iconSize: null }
  }

  return { iconSize: Math.round(parseFloat(pxMatch[1])) }
}
