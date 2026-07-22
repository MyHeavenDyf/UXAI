<script setup lang="ts">
import { computed, shallowRef, ref, watch } from "vue"
import { getIconComponentRef, sizeConfig, HUI_ICON_SIZE, mapShapeToHuiType, mapColorToHuiColor } from "./IconBase"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import type { IconNode } from "../types"
import { useIconProvider } from "../../composables/useIconProvider"

const { hasHuiIcons, iconNameMap } = useIconProvider()

const BACKGROUND_OPACITY = 0.15

const props = defineProps<A2UIComponentProps<IconNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")
const name = computed(() => (resolveValue(properties.name) as string) || "")

// ========== 图标组件解析（使用 getIconComponentRef 统一路径） ==========
const resolved = shallowRef<{ component: any; props: Record<string, any> } | null>(null)
const isHuiIcon = ref(false)

watch(
  name,
  (newName) => {
    if (!newName) {
      resolved.value = null
      isHuiIcon.value = false
      return
    }

    // 使用统一的 getIconComponentRef — 自动判断 hui/lucide
    const shape = resolveValue(properties.shape) as string | undefined
    const color = resolveValue(properties.color) as string | undefined
    const result = getIconComponentRef(newName, { shape, color })
    resolved.value = result

    // 判断是否为 hui 图标（用于样式差异化）
    isHuiIcon.value = hasHuiIcons.value && !!iconNameMap.value[newName] && !!result?.props?.iconId
  },
  { immediate: true },
)

// ========== 原始属性 → hui 属性映射（逻辑集中在 IconBase） ==========
const huiIconType = computed(() => mapShapeToHuiType(resolveValue(properties.shape) as string | undefined))

const huiIconColor = computed(() => mapColorToHuiColor(resolveValue(properties.color) as string | undefined))

// bgShape 统一从原始 shape 获取（hui/lucide 共用）
const bgShape = computed(() => properties.shape || "outline")

// ========== 图标大小（hui 固定 16，lucide 沿用 bgShape 自适应） ==========
const huiIconSize = HUI_ICON_SIZE

const iconSizeStyle = computed(() => {
  let sizeValue: string
  switch (bgShape.value) {
    case "circle":
      sizeValue = "min(100%, max(12px, 70%))"
      break
    case "square":
      sizeValue = "min(100%, max(12px, 60%))"
      break
    case "fill":
      sizeValue = "min(100%, max(12px, 70%))"
      break
    default:
      sizeValue = "100%"
  }
  return { width: sizeValue, height: sizeValue }
})

// ========== 图标颜色（lucide 用，保持原有逻辑不变） ==========
const color = computed(() => {
  let newColor = resolveValue(properties.color) as string
  switch (newColor) {
    case "primary":
      return "var(--icon-primary)"
    case "success":
      return "var(--icon-success)"
    case "warning":
      return "var(--icon-warning)"
    case "critical":
      return "var(--icon-critical)"
    case "error":
      return "var(--icon-error)"
    case "default":
      return "var(--color-icon-primary)"
    case "normal":
      return "var(--icon-normal)"
    case "neutral":
      return "var(--color-icon-primary)"
    case "info":
      return "var(--color-icon-primary)"
    case "inverse":
      return "var(--icon-inverse)"
    default:
      return newColor || "currentColor"
  }
})

const borderRadius = computed(() => {
  switch (bgShape.value) {
    case "fill":
      return "50%"
    case "circle":
      return "50%"
    case "square":
      const radius = Math.floor(sizeConfig["md"] * 0.25) || 2
      return `${radius}px`
    default:
      return "0"
  }
})

const mixPercentage = Math.round(BACKGROUND_OPACITY * 100)

// ========== wrapperStyle：API圆底托/方底托SVG自带背景时不叠加 ==========
const wrapperStyle = computed(() => {
  // API的圆底托(round_bottom2)/方底托(square_bottom2) SVG已自带背景托底，
  // 不需要Icon.vue再添加 backgroundColor/borderRadius
  const hasApiBackground = isHuiIcon.value && (bgShape.value === 'circle' || bgShape.value === 'square')

  if (hasApiBackground) {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color: color.value || "#191919",
      backgroundColor: "transparent",
      borderRadius: "0",
    }
  }

  // 原有逻辑：outline/fill/非hui-icon 使用Icon.vue提供的背景
  const hasBg = bgShape.value !== "outline"
  const isWhite = bgShape.value === "fill" || bgShape.value === "square"

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: isWhite ? "#fff" : color.value || "#191919",
    backgroundColor: isWhite ? color.value :
      hasBg
        ? `color-mix(in srgb, currentColor ${mixPercentage}%, transparent)`
        : "transparent",
    borderRadius: borderRadius.value
  }
})
</script>

<template>
  <div :id="id" :style="wrapperStyle" class="icon-base" :class="className">
    <!-- hui 图标（HuiSvgIcon 组件，通过 v-bind 展开 props） -->
    <component
      v-if="isHuiIcon && resolved"
      :is="resolved.component"
      v-bind="resolved.props"
      :size="huiIconSize"
      :type="huiIconType"
      :iconColor="huiIconColor"
    />
    <!-- lucide 图标 -->
    <component
      v-else-if="resolved"
      :is="resolved.component"
      :style="iconSizeStyle"
      :color="(bgShape === 'fill' || bgShape === 'square') ? '#fff' : color"
      :stroke-width="2"
    />
  </div>
</template>
