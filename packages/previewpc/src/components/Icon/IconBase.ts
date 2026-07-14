
import * as LucideIcons from "lucide-vue-next"
import { markRaw, ref, watch, type Ref } from "vue"
import type { Component } from "vue"
import { hasHuiIcons, iconNameMap, huiIconCache } from "../../composables/useIconProvider"

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
  default: "var(--icon-default)",
  normal: "var(--icon-normal)",
  neutral: "var(--icon-default)",
  info: "var(--icon-default)",
  inverse: "var(--icon-inverse)",
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
export function mapColorToHuiColor(color: string | undefined): string | undefined {
  if (!color) return undefined
  return SEMANTIC_COLOR_MAP[color] || color
}

const toPascalCase = (str: string) => {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")
}

/**
 * 获取 hui 图标组件引用（动态 import + 缓存）
 * @param name - A2UI 图标名称（如 "activity"、"x"）
 * @returns 对应的 hui 组件，若无法获取则返回 null
 */
export async function getHuiIconComponentRef(name: string): Promise<Component | null> {
  if (!name || !hasHuiIcons.value) return null

  const huiComponentName = iconNameMap.value[name]
  if (!huiComponentName) return null

  // 命中缓存
  const cached = huiIconCache.get(huiComponentName)
  if (cached) return cached

  try {
    // 可选依赖 @hui/icon-plus-vue，可能不存在，由 try-catch 处理
    const mod = await import(/* @vite-ignore */ '@hui/icon-plus-vue')
    const component = (mod as any)[huiComponentName]
    if (component) {
      const raw = markRaw(component as Component)
      huiIconCache.set(huiComponentName, raw)
      return raw
    }
  } catch (err) {
    console.warn(`[IconBase] 动态导入 hui 图标失败: ${huiComponentName}`, err)
  }

  return null
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
 *          hui 不可用时退回 lucide
 */
export async function getIconComponentRef(
  name: string,
  options?: IconComponentRefOptions,
): Promise<{ component: Component | null; props: Record<string, any> } | null> {
  if (!name) return null

  // ----- hui 分支 -----
  if (hasHuiIcons.value && iconNameMap.value[name]) {
    const component = await getHuiIconComponentRef(name)
    if (!component) return null
    return {
      component,
      props: {
        size: options?.size ?? HUI_ICON_SIZE,
        type: mapShapeToHuiType(options?.shape),
        iconColor: mapColorToHuiColor(options?.color),
      },
    }
  }

  // ----- lucide 分支 -----
  const componentName = toPascalCase(name)
  const component = (LucideIcons as any)[componentName] || LucideIcons.CircleEllipsis
  return {
    component,
    props: {
      size: options?.size ?? 24,
      color: resolveIconColor(options?.color),
      "stroke-width": options?.strokeWidth ?? 2,
    },
  }
}

/**
 * 响应式图标解析 - 监听图标名称变化，自动异步解析出 { component, props }
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
  const resolved = ref<{ component: Component | null; props: Record<string, any> } | null>(null)

  watch(
    nameRef,
    async (val) => {
      if (!val) { resolved.value = null; return }
      resolved.value = await getIconComponentRef(val, options)
    },
    { immediate: true },
  )

  return resolved
}
