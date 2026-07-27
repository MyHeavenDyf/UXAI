<script setup lang="ts">
import { computed, shallowRef, ref, watch } from "vue"
import { getIconComponentRef, sizeConfig, HUI_ICON_SIZE, mapShapeToHuiType, mapColorToHuiColor } from "./IconBase"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import type { IconNode } from "../types"
import { useIconProvider, toVariantId } from "../../composables/useIconProvider"
import { iconColors } from "../../utils/themeColors"

const { hasHuiIcons, variantDataMap } = useIconProvider()

const BACKGROUND_OPACITY = 0.15

const props = defineProps<A2UIComponentProps<IconNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")
const name = computed(() => (resolveValue(properties.name) as string) || "")

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
    const shape = (resolveValue(properties.shape) as string | undefined) || "outline"
    const color = (resolveValue(properties.color) as string | undefined) || "default"
    resolved.value = getIconComponentRef(newName, { shape, color })
    const variantId = toVariantId(newName, shape, color)
    isHuiIcon.value = hasHuiIcons.value && !!variantDataMap.value[variantId]?.svg
  },
  { immediate: true },
)

const huiIconType = computed(() => mapShapeToHuiType(resolveValue(properties.shape) as string | undefined))
const huiIconColor = computed(() => mapColorToHuiColor(resolveValue(properties.color) as string | undefined))
const bgShape = computed(() => properties.shape || "outline")

const hasApiBackground = computed(() => isHuiIcon.value && (bgShape.value === "circle" || bgShape.value === "square"))
const huiIconSize = computed(() => (hasApiBackground.value ? undefined : HUI_ICON_SIZE))

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

const color = computed(() => {
  const c = (resolveValue(properties.color) as string | undefined) || "default"
  const iconColor = iconColors[c as keyof typeof iconColors]
  if (iconColor) {
    return `var(${iconColor.color})`
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
      justifyContent: "center",
      backgroundColor: "transparent",
      borderRadius: "0",
    }
  }
  const hasBg = bgShape.value !== "outline"
  const isWhite = bgShape.value === "fill"
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: isWhite ? "#fff" : color.value || "#191919",
    backgroundColor: isWhite
      ? color.value
      : hasBg
        ? `color-mix(in srgb, currentColor ${mixPercentage}%, transparent)`
        : "transparent",
    borderRadius: borderRadius.value,
  }
})
</script>

<template>
  <div :id="id" :style="wrapperStyle" class="icon-base" :class="className">
    <component
      v-if="isHuiIcon && resolved"
      :is="resolved.component"
      v-bind="resolved.props"
      :size="huiIconSize"
      :type="huiIconType"
      :iconColor="huiIconColor"
    />
    <component
      v-else-if="resolved"
      :is="resolved.component"
      :style="iconSizeStyle"
      :color="bgShape === 'fill' ? '#fff' : color"
      :stroke-width="2"
    />
  </div>
</template>
