/**
 * hui-icon-plus 图标获取与缓存模块
 *
 * 新API协议：
 *   1. /assetRepository/iconPlus/getConfig — 获取配置（size/style/colors/fileType）
 *   2. /assetRepository/iconPlus/getIconInfo — 搜索图标（返回 url 字段）
 *   3. /assetRepository/iconPlus/getIcon — 用 url 获取 SVG（替代旧的 getSvg + icon_id）
 *
 * 底层缓存键为 url:styleValue:colorId，供 fetchIconBatch 去重和 fetchIconByUrl 使用。
 * 渲染路径不再依赖 svgCache，而是通过 variantDataMap 的 svgContent 直接获取。
 */

const ICON_API_URL = "/assetRepository/iconPlus/getIcon"

/** 底层 SVG 文本缓存，键为 url:styleValue:colorId（仅供去重和 fetchIconByUrl 使用） */
export const svgCache = new Map<string, string>()

/** getConfig 返回的默认颜色 ID，用于无明确 colorId 时的 fallback */
export let defaultColorId = ""

/** getConfig 返回的配置信息 */
export interface IconConfig {
  size: Array<{ key: string; value: string }>
  style: Array<{ key: string; value: string }>
  category: Array<{ key: string; value: string }>
  colors: Array<{ id: string; key: string; value: string; domain: string; type: string; style: string }>
  fileType: Array<{ key: string; value: string }>
}

/** 存储从 getConfig 获取的配置 */
export let iconConfig: IconConfig | null = null

export function getStyleValue(styleKey: string): string {
  const entry = iconConfig?.style?.find((s) => s.key === styleKey)
  return entry?.value || styleKey
}

/** Map A2UI shape to getConfig style key */
function shapeToStyleKey(shape: string): string {
  switch (shape) {
    case 'fill': return 'filled'
    case 'circle': return 'round_bottom2'
    case 'square': return 'square_bottom2'
    default: return 'border'
  }
}

/**
 * Resolve the API color ID for a given (shape, a2uiColor) combination.
 * Uses iconConfig.colors to find a matching color for the style.
 * Falls back to the first/default color for that style.
 */
export function resolveApiColorId(shape: string, a2uiColor?: string): string {
  const styleKey = shapeToStyleKey(shape)
  const styleValue = getStyleValue(styleKey)

  // Filter colors for this style
  const styleColors = (iconConfig?.colors || []).filter(c => c.style === styleValue)

  if (a2uiColor && styleColors.length > 0) {
    // Try to match A2UI color to API color by key or value
    // a2uiColor could be a semantic name (primary, success) or hex value
    // API color keys are like "Gray-10", "Cyan-5", "Rose-5,Rose-4,Rose-2"
    // API color values are like "#2E2E2E", "#0094A7", "#D756A8,#F081C4,#FFE1F1"
    const match = styleColors.find(c =>
      c.key === a2uiColor || c.value === a2uiColor ||
      c.key.split(',').includes(a2uiColor) || c.value.split(',').includes(a2uiColor)
    )
    if (match) return match.id
  }

  // Default: first color for this style
  return styleColors[0]?.id || defaultColorId
}

/**
 * 调用 /assetRepository/iconPlus/getConfig 获取图标服务配置
 * 同时作为 API 可用性检测
 * @returns true 表示 API 可用，false 表示不可用
 */
export async function fetchIconConfig(): Promise<boolean> {
  try {
    const resp = await fetch("/assetRepository/iconPlus/getConfig")
    if (!resp.ok) {
      console.warn("[fetchIcon] getConfig 请求失败 HTTP", resp.status)
      return false
    }
    const data = await resp.json()
    iconConfig = data as IconConfig

    // 从 colors 中选取一个默认颜色 ID（优先取线性/通用类型）
    if (iconConfig?.colors?.length) {
      const linearColor = iconConfig.colors.find((c) => c.type === "linear" || c.type === "通用色")
      defaultColorId = linearColor?.id || iconConfig.colors[0]?.id || ""
    }

    return true
  } catch (err: any) {
    console.warn("[fetchIcon] getConfig 请求失败:", err.message)
    return false
  }
}

/**
 * SVG 消毒：移除 <script> 标签和 on* 事件属性，防止 XSS
 */
export function sanitizeSvg(svg: string): string {
  if (!svg) return ""
  // 移除 <script> 标签及其内容
  let clean = svg.replace(/<script[\s\S]*?<\/script>/gi, "")
  // 移除 on* 事件属性（onclick、onload、onerror 等）
  clean = clean.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")
  clean = clean.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
  // 验证根元素是 <svg>
  if (!clean.trim().startsWith("<svg")) {
    console.warn("[fetchIcon] SVG 消毒后根元素不是 <svg>")
    return ""
  }
  return clean
}

/**
 * 批量获取图标（按 style + colorId 分组）
 *
 * 新API：GET /assetRepository/iconPlus/getIcon?url=...&size=...&style=...&color=...&fileType=svg
 *
 * @param iconUrls - 图标 url 数组（从 getIconInfo 返回的 url 字段）
 * @param style - 图标风格：styleValue如'线性'或'面性'（从getConfig获取）
 * @param size - 图标尺寸（从 config.size 的 key 中选取，默认 24）
 * @param colorId - API 颜色 ID（从 getConfig.colors 中选取，默认使用 defaultColorId）
 * @returns 缓存键 → SVG 文本的映射（键格式为 url:styleValue:colorId）
 */
export async function fetchIconBatch(
  iconUrls: string[],
  style?: string,
  size: string = "24",
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
      console.warn("[fetchIcon] getIcon 请求失败 HTTP", resp.status, "style:", resolvedStyle, "color:", resolvedColor)
      return new Map()
    }
    const data = await resp.json()

    // 处理响应：可能是单个对象或数组，新API响应格式 {url, name, data}
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
    console.warn("[fetchIcon] getIcon 请求失败:", err.message, "style:", resolvedStyle, "color:", resolvedColor)
    return new Map()
  }
}

/**
 * 单个获取图标（用于图标名称发现较晚的边缘场景）
 *
 * @param iconUrl - 图标 url（从 getIconInfo 返回）
 * @param style - 图标风格
 * @param size - 图标尺寸
 * @param colorId - API 颜色 ID
 * @returns SVG 文本，如果获取失败返回空字符串
 */
export async function fetchIconByUrl(iconUrl: string, style?: string, size: string = "24", colorId?: string): Promise<string> {
  const resolvedStyle = style ?? getStyleValue("border")
  const resolvedColor = colorId || defaultColorId
  const cacheKey = `${iconUrl}:${resolvedStyle}:${resolvedColor}`
  // 先检查缓存
  const cached = svgCache.get(cacheKey)
  if (cached) return cached

  const result = await fetchIconBatch([iconUrl], resolvedStyle, size, resolvedColor)
  return result.get(cacheKey) || ""
}

/** 清空 SVG 缓存（用于测试或强制刷新） */
export function clearSvgCache(): void {
  svgCache.clear()
}

/**
 * 将 A2UI shape 映射为 getIcon 的 style 参数（返回 config.style 的 value）
 */
export function mapShapeToApiStyle(shape?: string): string {
  switch (shape) {
    case "fill":
      return getStyleValue("filled")
    case "circle":
      return getStyleValue("round_bottom2")
    case "square":
      return getStyleValue("square_bottom2")
    default:
      return getStyleValue("border")
  }
}
