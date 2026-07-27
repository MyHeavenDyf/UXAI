import * as LucideIcons from "lucide-vue-next"
import { h, markRaw, shallowRef, watch, type Ref } from "vue"
import type { Component, VNode } from "vue"
import HuiSvgIcon from "./HuiSvgIcon.vue"
import { hasHuiIcons, variantDataMap, toVariantId } from "../../composables/useIconProvider"

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
 * 拼 key 查 variantDataMap，三级降级：
 *   精确匹配 → outline 降级 → outline&default 降级 → null（回退 lucide）
 */
export function getHuiIconComponentRef(
  name: string,
  shape?: string,
  color?: string,
): { component: Component; props: Record<string, any> } | null {
  if (!name || !hasHuiIcons.value) return null

  const s = shape || 'outline'
  const c = color || 'default'

  // 1. 精确匹配
  const exact = variantDataMap.value[toVariantId(name, s, c)]
  if (exact?.svg) {
    return { component: markRaw(HuiSvgIcon), props: {
      svgHtml: exact.svg, iconUrl: exact.url, size: HUI_ICON_SIZE,
      type: mapShapeToHuiType(s),
      iconColor: mapColorToHuiColor(c === 'default' ? undefined : c),
    }}
  }

  // 2. outline 降级（同 color）
  if (s !== 'outline') {
    const outline = variantDataMap.value[toVariantId(name, 'outline', c)]
    if (outline?.svg) {
      return { component: markRaw(HuiSvgIcon), props: {
        svgHtml: outline.svg, iconUrl: outline.url, size: HUI_ICON_SIZE,
        type: mapShapeToHuiType(s),
        iconColor: mapColorToHuiColor(c === 'default' ? undefined : c),
      }}
    }
  }

  // 3. outline&default 降级
  if (s !== 'outline' || c !== 'default') {
    const fallback = variantDataMap.value[toVariantId(name, 'outline', 'default')]
    if (fallback?.svg) {
      return { component: markRaw(HuiSvgIcon), props: {
        svgHtml: fallback.svg, iconUrl: fallback.url, size: HUI_ICON_SIZE,
        type: mapShapeToHuiType(s),
        iconColor: mapColorToHuiColor(c === 'default' ? undefined : c),
      }}
    }
  }

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

/** hui 优先 → lucide 回退 */
export function getIconComponentRef(
  name: string,
  options?: IconComponentRefOptions,
): { component: Component | null; props: Record<string, any> } | null {
  if (!name) return null

  const shape = options?.shape || 'outline'
  const color = options?.color || 'default'

  if (hasHuiIcons.value) {
    const huiRef = getHuiIconComponentRef(name, shape, color)
    if (huiRef) {
      if (options?.size) huiRef.props.size = options.size
      return huiRef
    }
  }

  const component = (LucideIcons as any)[toPascalCase(name)] || LucideIcons.CircleEllipsis
  return { component: markRaw(component), props: { size: options?.size ?? 24, color: resolveIconColor(options?.color), "stroke-width": options?.strokeWidth ?? 2 }}
}

/** 响应式图标解析 */
export function useIconComponentRef(
  nameRef: Ref<string | undefined | null>,
  options?: IconComponentRefOptions,
): Ref<{ component: Component | null; props: Record<string, any> } | null> {
  const resolved = shallowRef<{ component: Component | null; props: Record<string, any> } | null>(null)
  watch(nameRef, (val) => {
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
