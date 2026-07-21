<script setup lang="ts">
import { computed, shallowRef, ref, watch } from "vue"
import { getLucideIconComponentRef, getHuiIconComponentRef, sizeConfig, HUI_ICON_SIZE, mapShapeToHuiType, mapColorToHuiColor } from "./IconBase"
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

// ========== 图标组件解析（支持 hui / lucide 双源） ==========
const resolvedComponent = shallowRef<any>(null)
const isHuiIcon = ref(false)

watch(
  name,
  async (newName) => {
    if (!newName) {
      resolvedComponent.value = null
      isHuiIcon.value = false
      return
    }

    // 优先使用 hui 图标（当依赖存在且有映射时）
    if (hasHuiIcons.value && iconNameMap.value[newName]) {
      const huiRef = await getHuiIconComponentRef(newName)
      if (huiRef) {
        resolvedComponent.value = huiRef
        isHuiIcon.value = true
        return
      }
    }

    // 回退到 lucide 图标
    resolvedComponent.value = getLucideIconComponentRef(newName)
    isHuiIcon.value = false
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
      return "var(--color-icon-inverse)"
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
const wrapperStyle = computed(() => {
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
    <!-- hui 图标 -->
    <component
      v-if="isHuiIcon && resolvedComponent"
      :is="resolvedComponent"
      :size="huiIconSize"
      :type="huiIconType"
      :iconColor="huiIconColor"
    />
    <!-- lucide 图标 -->
    <component
      v-else-if="resolvedComponent"
      :is="resolvedComponent"
      :style="iconSizeStyle"
      :color="(bgShape === 'fill' || bgShape === 'square') ? '#fff' : color"
      :stroke-width="2"
    />
  </div>
</template>
