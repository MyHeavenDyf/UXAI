import * as LucideIcons from "lucide-vue-next"
import { h, markRaw, shallowRef, ref, watch, type Ref } from "vue"
import type { Component, VNode } from "vue"
import HuiSvgIcon from "./HuiSvgIcon.vue"
import { hasHuiIcons, iconNameMap, iconIdMap, svgCache } from "../../composables/useIconProvider"
import { mapShapeToApiStyle, getStyleValue } from "../../utils/fetchSvg"

export const sizeConfig = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
} as const

/** hui 图标默认大小 */
export const HUI_ICON_SIZE = 16

/** lucide 语义色 → CSS 变量映射表（hui/lucide 共用） */
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
  inverse: "var(--color-icon-inverse)",
}

/** getLucideIconComponentRef 支持的覆盖选项 */
export interface LucideIconOptions {
  size?: number
  color?: string
  strokeWidth?: number
}

/**
 * 将 A2UI color 解析为 CSS 变量或原色（lucide 用）
 * - 语义色（primary/success/...）→ CSS 变量
 * - 其他原样返回（如 #fff、red、currentColor）
 */
export function resolveIconColor(color: string | undefined): string {
  if (!color) return "currentColor"
  return SEMANTIC_COLOR_MAP[color] || color
}

/**
 * 将 A2UI shape 映射为 hui 图标 type
 * - outline    → lined
 * - fill       → filled
 * - circle     → round-bg
 * - square     → square-bg
 * - 其余/未设置 → lined（默认）
 */
export function mapShapeToHuiType(
  shape: string | undefined,
): "lined" | "filled" | "lined-twotone" | "filled-twotone" | "round-bg" | "square-bg" {
  switch (shape) {
    case "fill":
      return "filled"
    case "circle":
      return "round-bg"
    case "square":
      return "square-bg"
    default:
      return "lined"
  }
}

/**
 * 将 A2UI color 映射为 hui iconColor
 * - 语义色 → CSS 变量
 * - 其他原样透传（如 red, var(--x)）
 * - 未设置/空 → undefined（hui 自行处理默认色含 hover）
 */
export function mapColorToHuiColor(color: string | undefined): string[] | undefined {
  if (!color) return undefined
  return [SEMANTIC_COLOR_MAP[color] || color]
}

const toPascalCase = (str: string) => {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")
}

/**
 * 获取 hui 图标组件引用（从 svgCache 同步查找）
 *
 * @param name - A2UI 图标名称（如 "activity"、"x"）
 * @param shape - 图标形状（用于确定缓存键中的 style）
 * @returns { component: HuiSvgIcon, props } 或 null（未找到时回退到 lucide）
 */
export function getHuiIconComponentRef(
  name: string,
  shape?: string,
): { component: Component; props: Record<string, any> } | null {
  if (!name || !hasHuiIcons.value) return null

  const componentName = iconNameMap.value[name]
  if (!componentName) return null

  const iconId = iconIdMap.value[name]
  if (!iconId) return null

  // 根据 shape 确定缓存键中的 style
  const apiStyle = mapShapeToApiStyle(shape)
  const cacheKey = `${iconId}:${apiStyle}`
  const cachedSvg = svgCache.get(cacheKey)

  // 非 border 变体没找到时，退回到 border(线性) 变体
  const borderValue = getStyleValue('border')
  if (!cachedSvg && apiStyle !== borderValue) {
    const borderKey = `${iconId}:${borderValue}`
    const borderSvg = svgCache.get(borderKey)
    if (borderSvg) {
      return {
        component: markRaw(HuiSvgIcon),
        props: {
          iconId,
          svgHtml: borderSvg,
          size: HUI_ICON_SIZE,
          type: mapShapeToHuiType(shape),
          iconColor: mapColorToHuiColor(undefined),
        },
      }
    }
    return null
  }

  if (!cachedSvg) return null

  return {
    component: markRaw(HuiSvgIcon),
    props: {
      iconId,
      svgHtml: cachedSvg,
      size: HUI_ICON_SIZE,
      type: mapShapeToHuiType(shape),
      iconColor: mapColorToHuiColor(undefined),
    },
  }
}

/**
 * 获取 lucide 图标组件引用
 *
 * 使用方式：
 * - 无 options：返回组件本身（向后兼容）
 *   `<component :is="getLucideIconComponentRef(name)" />`
 *
 * - 有 options：返回 { component, props }，用 v-bind 展开
 *   `<component v-bind="getLucideIconComponentRef(name, { size: 16, color: 'red' })" />`
 *
 * @param name - A2UI 图标名称（如 "activity"）
 * @param options - 可选，默认属性（size、color、strokeWidth）
 *                  color 支持语义色（primary/success/...），自动转 CSS 变量
 */
export function getLucideIconComponentRef(name: string): Component | null
export function getLucideIconComponentRef(
  name: string,
  options: LucideIconOptions,
): { component: Component | null; props: Record<string, any> } | null
export function getLucideIconComponentRef(
  name: string,
  options?: LucideIconOptions,
): any {
  if (!name) return null
  const componentName = toPascalCase(name)
  const component = (LucideIcons as any)[componentName] || LucideIcons.CircleEllipsis

  if (!options) return component

  return {
    component,
    props: {
      size: options.size ?? 24,
      color: resolveIconColor(options.color),
      "stroke-width": options.strokeWidth ?? 2,
    },
  }
}

/** getIconComponentRef 支持的覆盖选项（lucide 格式，hui 内部映射） */
export interface IconComponentRefOptions {
  size?: number
  color?: string
  strokeWidth?: number
  /** hui type 映射用：outline / fill / circle / square */
  shape?: string
}

/**
 * 统一获取图标组件引用（自动判断使用 lucide 或 hui）
 *
 * 使用方式：
 *   <component v-bind="await getIconComponentRef(name, { size: 16, color: 'primary' })" />
 *
 * @param name - A2UI 图标名称（如 "activity"）
 * @param options - 可选，lucide 格式属性，hui 时自动映射
 * @returns { component, props } 可直接 v-bind 到 <component :is>
 *          hui 不可用或 SVG 未缓存时退回 lucide
 */
export function getIconComponentRef(
  name: string,
  options?: IconComponentRefOptions,
): { component: Component | null; props: Record<string, any> } | null {
  if (!name) return null

  // ----- hui 分支 -----
  if (hasHuiIcons.value && iconNameMap.value[name]) {
    const huiRef = getHuiIconComponentRef(name, options?.shape)
    if (huiRef) {
      // 覆盖 size 和 iconColor（如果 options 有指定）
      if (options?.size) huiRef.props.size = options.size
      if (options?.color) huiRef.props.iconColor = mapColorToHuiColor(options.color)
      return huiRef
    }
    // hui SVG 未缓存，回退到 lucide
  }

  // ----- lucide 分支 -----
  const componentName = toPascalCase(name)
  const component = (LucideIcons as any)[componentName] || LucideIcons.CircleEllipsis
  return {
    component: markRaw(component),
    props: {
      size: options?.size ?? 24,
      color: resolveIconColor(options?.color),
      "stroke-width": options?.strokeWidth ?? 2,
    },
  }
}

/**
 * 响应式图标解析 - 监听图标名称变化，自动解析出 { component, props }
 *
 * 适用于模板中无法直接 await 的场景：
 * @example
 *   const iconRef = useIconComponentRef(computed(() => props.iconName))
 *   // 模板: <component :is="iconRef.value?.component" v-bind="iconRef.value?.props ?? {}" />
 *
 * @param nameRef - 响应式图标名称 ref/computed
 * @param options - 图标属性选项
 */
export function useIconComponentRef(
  nameRef: Ref<string | undefined | null>,
  options?: IconComponentRefOptions,
): Ref<{ component: Component | null; props: Record<string, any> } | null> {
  const resolved = shallowRef<{ component: Component | null; props: Record<string, any> } | null>(null)

  watch(
    nameRef,
    (val) => {
      if (!val) { resolved.value = null; return }
      resolved.value = getIconComponentRef(val, options)
    },
    { immediate: true },
  )

  return resolved
}

/**
 * 创建图标渲染器（用于 Pattern B 消费者 —— Element Plus :icon prop）
 *
 * Element Plus 的 :icon 属性接受 Component 类型。
 * 对于 HuiSvgIcon 组件，需要同时传递 props（iconId/svgHtml 等），
 * 但 Element Plus 只接受 component 而不展开 props。
 *
 * 此函数返回一个函数式组件（渲染函数），将 component + props 封装为
 * 一个可被 Element Plus :icon 接受的 Component。
 *
 * @param iconRef - getIconComponentRef / useIconComponentRef 返回的 { component, props }
 * @returns 函数式组件（() => VNode），可直接传给 Element Plus :icon
 */
export function createIconRenderer(
  iconRef: { component: Component | null; props: Record<string, any> } | null,
): (() => VNode) | undefined {
  if (!iconRef?.component) return undefined
  const comp = iconRef.component
  const props = iconRef.props
  return () => h(comp!, props)
}
