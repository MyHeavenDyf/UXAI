<script setup lang="ts">
import { computed, watchEffect } from "vue"
import { getIconComponentRef, sizeConfig, mapColorToHuiColor } from "./IconBase"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import type { IconNode } from "../types"
import { useIconProvider, iconInfoMap, svgCache, svgCacheVersion, resolveSvgCacheKey, requestSvg, resolveApiShape } from "../../composables/useIconProvider"
import { iconColors, iconDarkColors } from "../../utils/themeColors"
import { useTheme } from "../../composables/useTheme"

const { hasHuiIcons } = useIconProvider()
const { isDark } = useTheme()

const BACKGROUND_OPACITY = 0.15

const props = defineProps<A2UIComponentProps<IconNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")
const name = computed(() => (resolveValue(properties.name) as string) || "")
const shape = computed(() => (resolveValue(properties.shape) as string | undefined) || "outline")
const color = computed(() => {
  let res = resolveValue(properties.color) as string | undefined
  if (!res) {
    if(shape.value === "two-tone") {
      res = isDark.value ? "#DFDFDF,#AEAEAE" : "#191919,#AEAEAE"
    } else if (shape.value === "circle" || shape.value === "square") {
      res = isDark.value ? "#2A2A2A,#939393,#AEAEAE" : "#191919,#AEAEAE,#FFFFFF"
    } else {
      res = isDark.value ? "#DFDFDF" : "#191919"
    }
  }
  return res
})

// watchEffect 主动驱动 requestSvg：即使模板 v-if 短路求值导致 resolved computed 未被访问，
// 也能确保 SVG 请求被触发并写入 svgCache
watchEffect(() => {
  svgCacheVersion.value  // 响应式依赖：SVG 到达时重新检查
  if (name.value && hasHuiIcons.value) {
    // 用 resolved shape 请求 SVG（主题感知：outline→lined/filled, two-tone→lined-twotone/filled-twotone）
    const resolvedShape = resolveApiShape(shape.value, isDark.value)
    requestSvg(name.value, resolvedShape, color.value, isDark.value)
    // 如果非 outline 变体也未缓存，也请求 outline 降级变体
    if (shape.value !== 'outline') {
      const fallbackShape = resolveApiShape('outline', isDark.value)
      requestSvg(name.value, fallbackShape, color.value, isDark.value)
    }
  }
})

// 响应式判断：SVG 是否已缓存（依赖 svgCacheVersion，SVG 写入后触发重算）
const isHuiIcon = computed(() => {
  svgCacheVersion.value  // 响应式依赖：SVG 到达时触发重算
  if (!name.value || !hasHuiIcons.value) return false
  const entry = iconInfoMap.value[name.value]
  if (!entry?.url) return false
  const resolvedShape = resolveApiShape(shape.value, isDark.value)
  const key = resolveSvgCacheKey(name.value, resolvedShape, color.value, isDark.value)
  return svgCache.has(key)
})

// 统一图标解析（hui 或 lucide 或 null），依赖 svgCacheVersion 确保 SVG 到达后重算
const resolved = computed(() => {
  svgCacheVersion.value  // 响应式依赖：SVG 到达时触发重算
  if (!name.value) return null
  return getIconComponentRef(name.value, { shape: shape.value, color: color.value, isDark: isDark.value })
})

const huiIconType = computed(() => resolveApiShape(shape.value, isDark.value))
const huiIconColor = computed(() => mapColorToHuiColor(color.value))
const bgShape = computed(() => shape.value)

// Lucide 图标的 shape 映射（Lucide 无原生双色/面性，需 CSS 模拟）：
//   two-tone → outline（Lucide 无双色，降级为线性）
//   outline + 深色 → fill（CSS 面性效果：白图标 + 彩色背景，模拟深色下实心图标）
const lucideBgShape = computed(() => {
  if (bgShape.value === 'two-tone') return 'outline'
  if (bgShape.value === 'outline' && isDark.value) return 'fill'
  return bgShape.value
})

const iconSizeStyle = computed(() => {
  switch (lucideBgShape.value) {
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
  const currentIconColors = isDark.value ? iconDarkColors : iconColors
  const iconColorEntry = currentIconColors[c as keyof typeof iconColors]
  if (iconColorEntry) {
    return `var(${iconColorEntry.color})`
  }
  return "currentColor"
})

const borderRadius = computed(() => {
  switch (lucideBgShape.value) {
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
  if (isHuiIcon.value) {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }
  const hasBg = lucideBgShape.value !== "outline"
  const isWhite = lucideBgShape.value === "fill"
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
    v-if="isHuiIcon"
    :id="id" 
    :style="wrapperStyle" 
    class="icon-base" 
    :class="className"
    :is="resolved?.component"
    v-bind="resolved?.props"
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
      :color="lucideBgShape === 'fill' ? '#fff' : iconColor"
      :stroke-width="2"
    />
  </div>
</template>
