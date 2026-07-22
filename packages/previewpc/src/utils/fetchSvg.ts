/**
 * hui-icon-plus SVG 获取与缓存模块
 *
 * 调用 /iconPlus/getSvg API 获取 SVG 文本，缓存到 Map 中。
 * 缓存键为 icon_id:style（如 "123:line"、"123:filled"），颜色不作为缓存维度。
 *
 * 请求策略：串行执行、按 style 分组批量请求、统一使用默认颜色。
 */

const SVG_API_URL = "/iconPlus/getSvg"

/** SVG 文本缓存，键为 icon_id:style */
export const svgCache = new Map<string, string>()

/** getConfig 返回的默认颜色 ID，用于所有 getSvg 请求 */
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

/**
 * 调用 /iconPlus/getConfig 获取图标服务配置
 * 同时作为 API 可用性检测
 * @returns true 表示 API 可用，false 表示不可用
 */
export async function fetchIconConfig(): Promise<boolean> {
  try {
    const resp = await fetch("/iconPlus/getConfig")
    if (!resp.ok) {
      console.warn("[fetchSvg] getConfig 请求失败 HTTP", resp.status)
      return false
    }
    const data = await resp.json()
    iconConfig = data as IconConfig

    // 从 colors 中选取一个默认颜色 ID（优先取线性/通用类型）
    if (iconConfig?.colors?.length) {
      const linearColor = iconConfig.colors.find((c) => c.type === "linear")
      defaultColorId = linearColor?.id || iconConfig.colors[0]?.id || ""
    }

    return true
  } catch (err: any) {
    console.warn("[fetchSvg] getConfig 请求失败:", err.message)
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
    console.warn("[fetchSvg] SVG 消毒后根元素不是 <svg>")
    return ""
  }
  return clean
}

/**
 * 批量获取 SVG（按 style 分组）
 *
 * @param iconIds - icon_id 数组
 * @param style - 图标风格：'线性' 或 '面性'
 * @param size - 图标尺寸（从 config.size 的 key 中选取，默认 24）
 * @returns 缓存键 → SVG 文本的映射
 */
export async function fetchSvgBatch(
  iconIds: string[],
  style: string = "line",
  size: string = "24",
): Promise<Map<string, string>> {
  if (!iconIds.length) return new Map()
  const resolvedStyle = style ?? getStyleValue("border")
  const idStr = iconIds.join(",")
  const url = `${SVG_API_URL}?icon_id=${encodeURIComponent(idStr)}&size=${encodeURIComponent(size)}&style=${encodeURIComponent(resolvedStyle)}&color=${encodeURIComponent(defaultColorId)}&fileType=svg`

  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.warn("[fetchSvg] getSvg 请求失败 HTTP", resp.status, "style:", style)
      return new Map()
    }
    const data = await resp.json()

    // 处理响应：可能是单个对象或数组
    const items: Array<{ icon_id: string; name: string; data: string }> = Array.isArray(data) ? data : [data]

    const result = new Map<string, string>()
    for (const item of items) {
      if (item.icon_id && item.data) {
        const cacheKey = `${item.icon_id}:${resolvedStyle}`
        const cleanSvg = sanitizeSvg(item.data)
        if (cleanSvg) {
          svgCache.set(cacheKey, cleanSvg)
          result.set(cacheKey, cleanSvg)
        }
      }
    }
    return result
  } catch (err: any) {
    console.warn("[fetchSvg] getSvg 请求失败:", err.message, "style:", resolvedStyle)
    return new Map()
  }
}

/**
 * 单个获取 SVG（用于图标名称发现较晚的边缘场景）
 *
 * @param iconId - 单个 icon_id
 * @param style - 图标风格
 * @param size - 图标尺寸
 * @returns SVG 文本，如果获取失败返回空字符串
 */
export async function fetchSvgById(iconId: string, style?: string, size: string = "24"): Promise<string> {
  const resolvedStyle = style ?? getStyleValue("border")
  const cacheKey = `${iconId}:${resolvedStyle}`
  // 先检查缓存
  const cached = svgCache.get(cacheKey)
  if (cached) return cached

  const result = await fetchSvgBatch([iconId], resolvedStyle, size)
  return result.get(cacheKey) || ""
}

/** 清空 SVG 缓存（用于测试或强制刷新） */
export function clearSvgCache(): void {
  svgCache.clear()
}

/**
 * 将 A2UI shape 映射为 getSvg 的 style 参数
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
