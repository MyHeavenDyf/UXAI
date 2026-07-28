<script setup lang="ts">
import { computed, watchEffect } from "vue"
import { getIconComponentRef, sizeConfig, HUI_ICON_SIZE, mapShapeToHuiType, mapColorToHuiColor } from "./IconBase"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import type { IconNode } from "../types"
import { useIconProvider, iconInfoMap, svgCache, svgCacheVersion, resolveSvgCacheKey, requestSvg } from "../../composables/useIconProvider"
import { iconColors } from "../../utils/themeColors"

const { hasHuiIcons } = useIconProvider()

const BACKGROUND_OPACITY = 0.15

const props = defineProps<A2UIComponentProps<IconNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")
const name = computed(() => (resolveValue(properties.name) as string) || "")
const shape = computed(() => (resolveValue(properties.shape) as string | undefined) || "outline")
const color = computed(() => (resolveValue(properties.color) as string | undefined) || "default")

// ★ 核心修复：用 watchEffect 确保 requestSvg 总是被调用，
// 即使模板 v-if 短路求值导致 resolved computed 未被访问
watchEffect(() => {
  svgCacheVersion.value  // 响应式依赖：SVG 到达时重新检查
  if (name.value && hasHuiIcons.value) {
    // 如果当前变体未缓存，请求 SVG（requestSvg 内部会检查缓存）
    requestSvg(name.value, shape.value, color.value)
    // 如果非 outline 变体也未缓存，也请求 outline 降级变体
    if (shape.value !== 'outline') {
      requestSvg(name.value, 'outline', color.value)
    }
  }
})

// 响应式判断：SVG 是否已缓存
const isHuiIcon = computed(() => {
  svgCacheVersion.value  // 响应式依赖：SVG 到达时触发重算
  if (!name.value || !hasHuiIcons.value) return false
  const entry = iconInfoMap.value[name.value]
  if (!entry?.url) return false
  const key = resolveSvgCacheKey(name.value, shape.value, color.value)
  return svgCache.has(key)
})

// 统一图标解析（hui 或 lucide 或 null）
// ★ 修复：加入 svgCacheVersion 依赖，SVG 到达后重算
const resolved = computed(() => {
  svgCacheVersion.value  // 响应式依赖：SVG 到达时触发重算
  if (!name.value) return null
  return getIconComponentRef(name.value, { shape: shape.value, color: color.value })
})

const huiIconType = computed(() => mapShapeToHuiType(shape.value))
const huiIconColor = computed(() => mapColorToHuiColor(color.value))
const bgShape = computed(() => shape.value)

const hasApiBackground = computed(() => isHuiIcon.value && (bgShape.value === "circle" || bgShape.value === "square"))

const iconSizeStyle = computed(() => {
  switch (bgShape.value) {
    case "circle":
      return { width: "min(100%, max(12px, 70%))", height: "min(100%, max(12px, 70%))" }
    case "square":
      return { width: "min(100%, max(12px, 60%))", height: "min(100%, max(12px, 60%))" }
    case "fill":
      return { width: "min(100%, max(12px, 70%))", height: "min(100%, max(12px, 70%))" }
    default:
      return { width: "100%", height: "100%" }
  }
})

const iconColor = computed(() => {
  const c = color.value
  const iconColorEntry = iconColors[c as keyof typeof iconColors]
  if (iconColorEntry) {
    return `var(${iconColorEntry.color})`
  }
  return "currentColor"
})

const borderRadius = computed(() => {
  switch (bgShape.value) {
    case "fill":
    case "circle":
      return "50%"
    case "square":
      return `${Math.floor(sizeConfig.md * 0.25) || 2}px`
    default:
      return "0"
  }
})

const mixPercentage = Math.round(BACKGROUND_OPACITY * 100)

const wrapperStyle = computed(() => {
  if (hasApiBackground.value) {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }
  const hasBg = bgShape.value !== "outline"
  const isWhite = bgShape.value === "fill"
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: isWhite ? "#fff" : iconColor.value || "#191919",
    backgroundColor: isWhite
      ? iconColor.value
      : hasBg
        ? `color-mix(in srgb, currentColor ${mixPercentage}%, transparent)`
        : "transparent",
    borderRadius: borderRadius.value,
  }
})
</script>

<template>
  <component
    v-if="isHuiIcon && resolved"
    :id="id" 
    :style="wrapperStyle" 
    class="icon-base" 
    :class="className"
    :is="resolved.component"
    v-bind="resolved.props"
    :type="huiIconType"
    :iconColor="huiIconColor"
  />
  <div 
    v-else-if="!hasHuiIcons && resolved" 
    :id="id" 
    :style="wrapperStyle" 
    class="icon-base" 
    :class="className">
    <component
      :is="resolved.component"
      :style="iconSizeStyle"
      :color="bgShape === 'fill' ? '#fff' : iconColor"
      :stroke-width="2"
    />
  </div>
</template>
