import * as LucideIcons from "lucide-vue-next"
import { h, markRaw, shallowRef, watch, type Ref } from "vue"
import type { Component, VNode } from "vue"
import HuiSvgIcon from "./HuiSvgIcon.vue"
import { hasHuiIcons, iconInfoMap, svgCache, svgCacheVersion, resolveSvgCacheKey, requestSvg } from "../../composables/useIconProvider"

export const sizeConfig = { xs: 12, sm: 16, md: 24, lg: 32, xl: 40 } as const
export const HUI_ICON_SIZE = 16

// ========== 语义色映射 ==========

const SEMANTIC_COLOR_MAP: Record<string, string> = {
  primary: "var(--icon-primary)",
  success: "var(--icon-success)",
  warning: "var(--icon-warning)",
  critical: "var(--icon-critical)",
  error: "var(--icon-error)",
  default: "var(--color-icon-primary)",
  normal: "var(--icon-normal)",
  neutral: "var(--color-icon-primary)",
  info: "var(--color-icon-primary)",
  inverse: "var(--icon-inverse)",
}

export interface LucideIconOptions {
  size?: number
  color?: string
  strokeWidth?: number
}

/** 语义色 → CSS 变量，其他原样返回 */
export function resolveIconColor(color: string | undefined): string {
  if (!color) return "currentColor"
  return SEMANTIC_COLOR_MAP[color] || color
}

/** shape → hui type */
export function mapShapeToHuiType(shape: string | undefined): "lined" | "filled" | "lined-twotone" | "filled-twotone" | "round-bg" | "square-bg" {
  switch (shape) {
    case "fill": return "filled"
    case "circle": return "round-bg"
    case "square": return "square-bg"
    default: return "lined"
  }
}

/** color → hui iconColor 数组 */
export function mapColorToHuiColor(color: string | undefined): string[] | undefined {
  if (!color) return undefined
  return [SEMANTIC_COLOR_MAP[color] || color]
}

const toPascalCase = (str: string) =>
  str.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("")

// ========== hui 图标查找 ==========

/**
 * 拼 svgCache key 查缓存，三级查找：
 *   精确匹配 → outline 降级 → null（空白，请求后响应式显示）
 */
export function getHuiIconComponentRef(
  name: string,
  shape?: string,
  color?: string,
): { component: Component; props: Record<string, any> } | null {
  if (!name || !hasHuiIcons.value) return null

  const s = shape || 'outline'
  const c = color || 'default'

  // 1. 查 iconInfoMap[name] 获取 url
  const entry = iconInfoMap.value[name]
  if (!entry?.url) return null  // 无映射 → 图标空白

  // 2. 用 JSON 数据值拼 svgCache key
  const cacheKey = resolveSvgCacheKey(name, s, c)

  // 3. 查 svgCache
  const svg = svgCache.get(cacheKey)
  if (svg) {
    return { component: markRaw(HuiSvgIcon), props: {
      svgHtml: svg, iconUrl: entry.url, size: HUI_ICON_SIZE,
      type: mapShapeToHuiType(s),
      iconColor: mapColorToHuiColor(c === 'default' ? undefined : c),
    }}
  }

  // 4. 简化降级：查同 name 的 outline&同 color 变体缓存
  if (s !== 'outline') {
    const fallbackKey = resolveSvgCacheKey(name, 'outline', c)
    const fallbackSvg = svgCache.get(fallbackKey)
    if (fallbackSvg) {
      return { component: markRaw(HuiSvgIcon), props: {
        svgHtml: fallbackSvg, iconUrl: entry.url, size: HUI_ICON_SIZE,
        type: mapShapeToHuiType(s),
        iconColor: mapColorToHuiColor(c === 'default' ? undefined : c),
      }}
    }
  }

  // 5. 无缓存 → 请求并返回 null（图标空白，SVG 到达后响应式显示）
  requestSvg(name, s, c)
  return null
}

// ========== lucide 图标 ==========

export function getLucideIconComponentRef(name: string): Component | null
export function getLucideIconComponentRef(name: string, options: LucideIconOptions): { component: Component | null; props: Record<string, any> } | null
export function getLucideIconComponentRef(name: string, options?: LucideIconOptions): any {
  if (!name) return null
  const component = (LucideIcons as any)[toPascalCase(name)] || LucideIcons.CircleEllipsis
  if (!options) return component
  return { component, props: { size: options.size ?? 24, color: resolveIconColor(options.color), "stroke-width": options.strokeWidth ?? 2 }}
}

// ========== 统一入口 ==========

export interface IconComponentRefOptions {
  size?: number
  color?: string
  strokeWidth?: number
  shape?: string
}

/**
 * hui API 可用 → 只走 hui，SVG 未缓存则空白（不发 lucide）
 * hui API 不可用 → lucide 回退
 */
export function getIconComponentRef(
  name: string,
  options?: IconComponentRefOptions,
): { component: Component | null; props: Record<string, any> } | null {
  if (!name) return null
  const shape = options?.shape || 'outline'
  const color = options?.color || 'default'

  if (hasHuiIcons.value) {
    // hui API 可用 → 只走 hui，SVG 未缓存则空白
    const huiRef = getHuiIconComponentRef(name, shape, color)
    if (huiRef) {
      if (options?.size) huiRef.props.size = options.size
      return huiRef
    }
    return null  // 空白，等 SVG 到达后响应式显示
  }

  // hui API 不可用 → lucide 回退
  const component = (LucideIcons as any)[toPascalCase(name)] || LucideIcons.CircleEllipsis
  return { component: markRaw(component), props: { size: options?.size ?? 24, color: resolveIconColor(options?.color), "stroke-width": options?.strokeWidth ?? 2 }}
}

/** 响应式图标解析（同时追踪 svgCacheVersion，SVG 到达后重新解析） */
export function useIconComponentRef(
  nameRef: Ref<string | undefined | null>,
  options?: IconComponentRefOptions,
): Ref<{ component: Component | null; props: Record<string, any> } | null> {
  const resolved = shallowRef<{ component: Component | null; props: Record<string, any> } | null>(null)
  watch([nameRef, svgCacheVersion], ([val]) => {
    resolved.value = val ? getIconComponentRef(val, options) : null
  }, { immediate: true })
  return resolved
}

/** 封装为 Element Plus :icon 可接受的函数式组件 */
export function createIconRenderer(
  iconRef: { component: Component | null; props: Record<string, any> } | null,
): (() => VNode) | undefined {
  if (!iconRef?.component) return undefined
  return () => h(iconRef.component!, iconRef.props)
}
