/**
 * hui-icon-plus 图标获取与缓存
 *
 * API 协议：
 *   1. /assetRepository/iconPlus/getConfig — 获取配置
 *   2. /assetRepository/iconPlus/getIconInfo — 搜索图标（返回 url）
 *   3. /assetRepository/iconPlus/getIcon — 用 url 获取 SVG
 *
 * svgCache 键格式 url:styleValue:colorId，仅供去重，渲染通过 variantDataMap.svg
 */

const ICON_API_URL = "/assetRepository/iconPlus/getIcon"

/** 底层缓存（去重用），键为 url:styleValue:colorId */
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

function shapeToStyleKey(shape: string): string {
  switch (shape) {
    case 'fill': return 'filled'
    case 'circle': return 'round_bottom2'
    case 'square': return 'square_bottom2'
    default: return 'border'
  }
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
    const resp = await fetch("/assetRepository/iconPlus/getConfig")
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

/** 批量获取图标 SVG，按 (style, colorId) 分组 */
export async function fetchIconBatch(
  iconUrls: string[],
  style?: string,
  size: string = "16",
  colorId?: string,
): Promise<Map<string, string>> {
  if (!iconUrls.length) return new Map()
  const resolvedStyle = style ?? getStyleValue("border")
  const resolvedColor = colorId || defaultColorId
  const urlStr = iconUrls.join(",")
  const apiUrl = `${ICON_API_URL}?url=${encodeURIComponent(urlStr)}&size=${encodeURIComponent(size)}&style=${encodeURIComponent(resolvedStyle)}&color=${encodeURIComponent(resolvedColor)}&fileType=svg`

  try {
    const resp = await fetch(apiUrl)
    if (!resp.ok) {
      console.warn("[fetchIcon] getIcon 失败 HTTP", resp.status, "style:", resolvedStyle, "color:", resolvedColor)
      return new Map()
    }
    const data = await resp.json()
    const items: Array<{ url: string; name: string; data: string }> = Array.isArray(data) ? data : [data]

    const result = new Map<string, string>()
    for (const item of items) {
      if (item.url && item.data) {
        const cacheKey = `${item.url}:${resolvedStyle}:${resolvedColor}`
        const cleanSvg = sanitizeSvg(item.data)
        if (cleanSvg) {
          svgCache.set(cacheKey, cleanSvg)
          result.set(cacheKey, cleanSvg)
        }
      }
    }
    return result
  } catch (err: any) {
    console.warn("[fetchIcon] getIcon 失败:", err.message, "style:", resolvedStyle, "color:", resolvedColor)
    return new Map()
  }
}

/** 单个获取图标（边缘场景） */
export async function fetchIconByUrl(iconUrl: string, style?: string, size: string = "16", colorId?: string): Promise<string> {
  const resolvedStyle = style ?? getStyleValue("border")
  const resolvedColor = colorId || defaultColorId
  const cacheKey = `${iconUrl}:${resolvedStyle}:${resolvedColor}`
  const cached = svgCache.get(cacheKey)
  if (cached) return cached

  const result = await fetchIconBatch([iconUrl], resolvedStyle, size, resolvedColor)
  return result.get(cacheKey) || ""
}

/** 清空缓存 */
export function clearSvgCache(): void {
  svgCache.clear()
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
