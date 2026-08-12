/**
 * hui-icon-plus 图标获取与缓存
 *
 * 新架构（按需获取）：
 *   1. getConfig — 获取配置 + 检测 API 可用性
 *   2. getIconInfo — 搜索图标（返回 url），存入 iconInfoMap (name → {name, url})
 *   3. getIcon — 渲染时按需获取 SVG，存入 svgCache (name&shape&hex(color) → svg)
 *
 * svgCache 键格式 name&shape&hex(color)：color 部分使用解析后的 hex 值，
 * 不同主题下同色名映射到不同 hex 值，避免 cache key 碰撞。
 * svgCacheVersion 每次 svgCache 写入后自增，驱动 Vue 响应式更新
 */

import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_ICON_API_BASE || ''
const ICON_API_URL = `${API_BASE}/assetRepository/iconPlus/getIcon`

/** svgCache 版本号，每次写入自增，驱动 Vue 响应式更新 */
export const svgCacheVersion = ref(0)

/** SVG 缓存，键为 name&shape&hex(color)，值为 SVG 字符串 */
export const svgCache = new Map<string, string>()

/** 默认颜色 ID fallback */
export let defaultColorId = ""

/** 语义色名 / CSS 变量名 → hex 色值解析 */
import { themeColors, iconColors, iconDarkColors } from './themeColors'
import { useTheme } from '../composables/useTheme'

const { isDark } = useTheme()

export interface IconConfig {
  size: Array<{ key: string; value: string }>
  style: Array<{ key: string; value: string }>
  category: Array<{ key: string; value: string }>
  colors: Array<{ id: string; key: string; value: string; domain: string; type: string; style: string }>
  fileType: Array<{ key: string; value: string }>
}

export let iconConfig: IconConfig | null = null

export function getStyleValue(styleKey: string): string {
  const entry = iconConfig?.style?.find((s) => s.key === styleKey)
  return entry?.value || styleKey
}

/**
 * 将语义 shape 解析为具体 API shape（主题感知）
 *
 * - outline: 浅色 → lined, 深色 → filled
 * - two-tone: 浅色 → lined-twotone, 深色 → filled-twotone
 * - circle/square: 始终不变（不随主题切换）
 * - lined/filled: 显式指定，不随主题切换（其他组件用）
 */
export function resolveApiShape(shape: string, isDark?: boolean): string {
  switch (shape) {
    case 'outline':   return isDark ? 'filled' : 'lined'
    case 'two-tone':  return isDark ? 'filled-twotone' : 'lined-twotone'
    case 'circle':    return 'circle'
    case 'square':    return 'square'
    case 'lined':     return 'lined'
    case 'filled':    return 'filled'
    default:          return isDark ? 'filled' : 'lined'
  }
}

/** 内部辅助：resolved shape → API styleKey 字符串，供 resolveApiColorId 和 mapShapeToApiStyle 使用 */
export function shapeToStyleKey(resolvedShape: string): string {
  switch (resolvedShape) {
    case 'filled':          return 'filled'
    case 'lined-twotone':   return 'two_colors1'
    case 'filled-twotone':  return 'two_colors2'
    case 'circle':          return 'round_bottom2'
    case 'square':          return 'square_bottom2'
    default:                return 'border'  // lined 等
  }
}

/**
 * 解析语义色名为 hex 值（用于 cache key），根据 resolved shape 选择 color/twoColor/threeColor
 *
 * 不同主题下语义色映射到不同 hex 值，因此 cache key 需用 hex 值避免碰撞。
 * - 同色（如 info 两主题下色值相同）→ 同一 cache key，只缓存一次
 * - 异色（default 浅色=黑 / 深色=白）→ 不同 cache key，自然区分
 */
export function resolveColorHex(color: string | undefined, resolvedShape: string, isDark?: boolean): string {
  const c = color || 'default'
  const currentIconColors = isDark ? iconDarkColors : iconColors
  const entry = (currentIconColors as Record<string, { color: string; twoColor?: string; threeColor?: string }>)[c]

  if (!entry) return c  // 未知色名，原样返回

  // 根据 resolved shape 选择颜色条目
  let colorValue: string
  if (resolvedShape === 'filled-twotone' || resolvedShape === 'lined-twotone') {
    colorValue = entry.twoColor || entry.color
  } else if (resolvedShape === 'circle' || resolvedShape === 'square') {
    colorValue = entry.threeColor || entry.color
  } else {
    colorValue = entry.color
  }

  // 将 CSS 变量解析为 hex
  const hexValues = colorValue.split(',').map(v => {
    const trimmed = v.trim()
    return (themeColors as Record<string, string>)[trimmed] || trimmed
  })

  return hexValues.join(',')
}

/**
 * svgCache key：使用 resolved shape 拼接，shape 缺省 lined，color 缺省 default
 *
 * color 部分使用解析后的 hex 颜色值（而非语义色名），避免浅色/深色主题下同色名碰撞。
 */
export function resolveSvgCacheKey(name: string, resolvedShape?: string, color?: string, isDark?: boolean): string {
  const s = resolvedShape || 'lined'
  const resolvedColor = resolveColorHex(color, s, isDark)
  return `${name}&${s}&${resolvedColor}`
}

/**
 * 将 hex 颜色字符串转为 RGB 数组
 * @param hex 如 "#0067D1" 或 "0067D1"
 * @returns [R, G, B] 数组，解析失败返回 null
 */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, '')
  if (h.length !== 6) return null
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null
  return [r, g, b]
}

/**
 * 计算两个 RGB 颜色之间的欧氏距离（越小越相似）
 */
function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

/**
 * 计算两组颜色值的相似度距离
 * - 主色（第一个颜色）权重最高
 * - 次色权重较低
 * - 如果两组颜色数量不同，只比较各自的主色
 */
function colorGroupDistance(targetHexes: string[], apiHexes: string[]): number {
  const t0 = hexToRgb(targetHexes[0])
  const a0 = hexToRgb(apiHexes[0])
  if (!t0 || !a0) return Infinity

  // 主色距离权重 0.7
  let distance = rgbDistance(t0, a0) * 0.7

  // 次色距离权重 0.3（如果双方都有次色）
  if (targetHexes.length > 1 && apiHexes.length > 1) {
    const t1 = hexToRgb(targetHexes[1])
    const a1 = hexToRgb(apiHexes[1])
    if (t1 && a1) {
      distance += rgbDistance(t1, a1) * 0.3
    }
  }

  return distance
}

/**
 * 从颜色列表中找到与目标颜色最相似的颜色 ID
 * @param targetHexes 目标颜色 hex 值数组（如 ["#0067D1"] 或 ["#0067D1", "#8ABEF3"]）
 * @param colorsByType 同类型下的 API 颜色列表
 * @returns 最相似颜色的 ID，无法计算时返回 null
 */
function findClosestColorId(targetHexes: string[], colorsByType: Array<{ id: string; value: string }>): string | null {
  let minDistance = Infinity
  let closestId: string | null = null

  for (const c of colorsByType) {
    const apiHexes = c.value.split(',').map(v => v.trim())
    const dist = colorGroupDistance(targetHexes, apiHexes)
    if (dist < minDistance) {
      minDistance = dist
      closestId = c.id
    }
  }

  return closestId
}

/**
 * 解析 API colorId：先按类型匹配颜色列表，再按颜色值匹配具体 colorId
 *
 * 步骤：
 *   1. resolvedShape → styleKey → styleValue（如 circle → round_bottom2 → 圆底托）
 *   2. 从 iconConfig.colors 中筛选 c.style === styleValue 的颜色列表
 *   3. a2uiColor → 根据 resolvedShape 选择 color/twoColor/threeColor 条目，解析为 hex 后匹配
 *   4. 未精确匹配到时，按 RGB 色距匹配最相似的颜色
 *   5. 仍无法匹配则取该类型下的第一个颜色作为默认
 */

export function resolveApiColorId(resolvedShape: string, a2uiColor?: string): string {
  // ① resolvedShape → styleValue
  const styleValue = getStyleValue(shapeToStyleKey(resolvedShape))

  // ② 按类型筛选颜色列表
  const colorsByType = (iconConfig?.colors || []).filter(c => c.style === styleValue)
  if (!colorsByType.length) return defaultColorId

  // ③ 匹配颜色：根据 resolvedShape 选择对应的颜色条目
  if (a2uiColor) {
    const currentIconColors = isDark.value ? iconDarkColors : iconColors
    const iconColorEntry = (currentIconColors as Record<string, { color: string; twoColor?: string; threeColor?: string }>)[a2uiColor]

    // 根据 resolvedShape 决定使用哪个颜色条目
    let colorValue: string | undefined
    if (resolvedShape === 'filled-twotone') {
      colorValue = iconColorEntry?.twoColor
    } else if (resolvedShape === 'circle' || resolvedShape === 'square') {
      colorValue = iconColorEntry?.threeColor
    } else {
      // lined, filled, lined-twotone → 单色
      colorValue = iconColorEntry?.color
    }

    if (colorValue) {
      // 将逗号分隔的 CSS 变量逐个解析为 hex
      const hexValues = colorValue.split(',').map(v => {
        const trimmed = v.trim()
        return (themeColors as Record<string, string>)[trimmed] || trimmed
      })

      // 匹配 API color 条目：检查所有 hex 值是否都在 API color 的 value 中
      const match = colorsByType.find(c => {
        const apiValues = c.value.split(',').map(v => v.trim())
        return hexValues.every(h => apiValues.includes(h))
      })
      if (match) return match.id

      // ④ 精确匹配失败，按 RGB 色距匹配最相似的颜色
      const closestId = findClosestColorId(hexValues, colorsByType)
      if (closestId) return closestId
    }

    // fallback：用 color 单色条目尝试匹配
    const cssVar = iconColorEntry?.color || a2uiColor
    const hexColor = (themeColors as Record<string, string>)[cssVar] || a2uiColor
    const match = colorsByType.find(c => c.value.split(',').includes(hexColor))
    if (match) return match.id

    // 单色 fallback 也尝试相似色匹配
    const closestId = findClosestColorId([hexColor], colorsByType)
    if (closestId) return closestId
  }

  // ⑤ 仍无法匹配，取该类型下的默认颜色
  return colorsByType[0].id
}

/** 调 getConfig 获取配置 + 检测 API 可用性 */
export async function fetchIconConfig(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/assetRepository/iconPlus/getConfig`)
    if (!resp.ok) {
      console.warn("[fetchIcon] getConfig 失败 HTTP", resp.status)
      return false
    }
    const data = await resp.json()
    iconConfig = data as IconConfig

    if (iconConfig?.colors?.length) {
      const linearColor = iconConfig.colors.find((c) => c.type === "linear" || c.type === "通用色")
      defaultColorId = linearColor?.id || iconConfig.colors[0]?.id || ""
    }
    return true
  } catch (err: any) {
    console.warn("[fetchIcon] getConfig 失败:", err.message)
    return false
  }
}

/** SVG 消毒：移除 script/on* 事件，防 XSS */
export function sanitizeSvg(svg: string): string {
  if (!svg) return ""
  let clean = svg.replace(/<script[\s\S]*?<\/script>/gi, "")
  clean = clean.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")
  clean = clean.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
  if (!clean.trim().startsWith("<svg")) {
    console.warn("[fetchIcon] SVG 消毒后根元素不是 <svg>")
    return ""
  }
  return clean
}

/**
 * 批量获取图标 SVG（纯 API 调用，不写 svgCache）
 *
 * svgCache 写入由 IconRequestQueue 统一处理，
 * 因为同一批次内不同 entry 可能有不同的 shape/color → 不同 svgCache key
 *
 * @param urls 图标 URL 列表
 * @param style API style 参数（中文值如 "线性"）
 * @param size 图标尺寸
 * @param colorId API color 参数（id 如 "GTS_线性_Gray-10"）
 * @returns Map<url, {name, data}> — url → 消毒后的 SVG 数据
 */
export async function fetchIconBatch(
  urls: string[],
  style: string,
  size: string = "16",
  colorId: string,
): Promise<Map<string, { name: string; data: string }>> {
  if (!urls.length) return new Map()
  const urlStr = urls.join(",")
  const apiUrl = `${ICON_API_URL}?url=${encodeURIComponent(urlStr)}&size=${encodeURIComponent(size)}&style=${encodeURIComponent(style)}&color=${encodeURIComponent(colorId)}&fileType=svg`

  try {
    const resp = await fetch(apiUrl)
    if (!resp.ok) {
      console.warn("[fetchIcon] getIcon 失败 HTTP", resp.status, "style:", style, "color:", colorId)
      return new Map()
    }
    const data = await resp.json()
    const items: Array<{ url: string; name: string; data: string }> = Array.isArray(data) ? data : [data]

    const result = new Map<string, { name: string; data: string }>()
    for (const item of items) {
      if (item.url && item.data) {
        const cleanSvg = sanitizeSvg(item.data)
        if (cleanSvg) {
          result.set(item.url, { name: item.name || '', data: cleanSvg })
        }
      }
    }
    return result
  } catch (err: any) {
    console.warn("[fetchIcon] getIcon 失败:", err.message, "style:", style, "color:", colorId)
    return new Map()
  }
}

/** 清空缓存 */
export function clearSvgCache(): void {
  svgCache.clear()
  svgCacheVersion.value++
}

/** resolved shape → API style 中文值（组合 shapeToStyleKey + getStyleValue，用于 API 请求参数） */
export function mapShapeToApiStyle(resolvedShape?: string): string {
  return getStyleValue(shapeToStyleKey(resolvedShape || 'lined'))
}
