/**
 * hui-icon-plus 图标获取与缓存
 *
 * 新架构（按需获取）：
 *   1. getConfig — 获取配置 + 检测 API 可用性
 *   2. getIconInfo — 搜索图标（返回 url），存入 iconInfoMap (name → {name, url})
 *   3. getIcon — 渲染时按需获取 SVG，存入 svgCache (name&shape&color → svg)
 *
 * svgCache 键格式 name&shape&color（直接用 JSON 数据值），渲染时主查找
 * svgCacheVersion 每次 svgCache 写入后自增，驱动 Vue 响应式更新
 */

import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_ICON_API_BASE || ''
const ICON_API_URL = `${API_BASE}/assetRepository/iconPlus/getIcon`

/** svgCache 版本号，每次写入自增，驱动 Vue 响应式更新 */
export const svgCacheVersion = ref(0)

/** SVG 缓存，键为 name&shape&color（JSON 数据值），值为 SVG 字符串 */
export const svgCache = new Map<string, string>()

/** 默认颜色 ID fallback */
export let defaultColorId = ""

/** 从 useTheme 获取当前主题的 icon 颜色映射（语义色→hex） */
import { iconColorMap } from '../composables/useTheme'

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

/** shape → API styleKey（导出，供请求队列等使用） */
export function shapeToStyleKey(shape: string): string {
  switch (shape) {
    case 'fill': return 'filled'
    case 'circle': return 'round_bottom2'
    case 'square': return 'square_bottom2'
    default: return 'border'
  }
}

/** svgCache key：直接用 JSON 数据值拼接，shape 缺省 outline，color 缺省 default */
export function resolveSvgCacheKey(name: string, shape?: string, color?: string): string {
  const s = shape || 'outline'
  const c = color || 'default'
  return `${name}&${s}&${c}`
}

/**
 * 解析 API colorId：先按类型匹配颜色列表，再按颜色值匹配具体 colorId
 *
 * 步骤：
 *   1. shape → styleKey → styleValue（如 circle → round_bottom2 → 圆底托）
 *   2. 从 iconConfig.colors 中筛选 c.style === styleValue 的颜色列表
 *   3. a2uiColor → 先通过 iconColorMap 转为 hex，再在颜色列表中匹配 c.key 或 c.value
 *   4. 未匹配到则取该类型下的第一个颜色作为默认
 */
export function resolveApiColorId(shape: string, a2uiColor?: string): string {
  // ① shape → styleValue
  const styleValue = getStyleValue(shapeToStyleKey(shape))

  // ② 按类型筛选颜色列表
  const colorsByType = (iconConfig?.colors || []).filter(c => c.style === styleValue)
  if (!colorsByType.length) return defaultColorId

  // ③ 匹配颜色：语义色先转 hex，再用 hex/key 匹配
  if (a2uiColor) {
    // iconColorMap（computed）把语义色名转为当前主题下的 hex 值
    const hexColor = iconColorMap.value[a2uiColor] || a2uiColor

    const match = colorsByType.find(c => c.value.split(',').includes(hexColor))
    if (match) return match.id
  }

  // ④ 未匹配到颜色，取该类型下的默认颜色
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

/** shape → API style value */
export function mapShapeToApiStyle(shape?: string): string {
  switch (shape) {
    case "fill": return getStyleValue("filled")
    case "circle": return getStyleValue("round_bottom2")
    case "square": return getStyleValue("square_bottom2")
    default: return getStyleValue("border")
  }
}
