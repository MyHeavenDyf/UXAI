<script setup lang="ts">
import { computed, ref } from "vue"
import { getLucideIconComponentRef, sizeConfig } from "./IconBase"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import type { IconNode } from "../types"

const BACKGROUND_OPACITY = 0.15


const getPadding = (size: string="md", paddingPercent = 0.25) => {
  return (
    Math.floor(sizeConfig[size as keyof typeof sizeConfig] * paddingPercent) ||
    2
  )
}

const props = defineProps<A2UIComponentProps<IconNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")
const name = computed(() => (resolveValue(properties.name) as string) || "")

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
      return "var(--icon-default)"
    case "neutral":
      return "var(--icon-default)"
    case "info":
      return "var(--icon-default)"
    case "inverse":
      return "var(--icon-inverse)"
    default:
      return newColor || "currentColor"
  }
})
const bgShape = computed(() => properties.shape || "outline")

const iconSizeStyle = computed(() => {
  let sizeValue: string
  switch (bgShape.value) {
    case "circle":
      sizeValue = 'min(100%, max(12px, 70%))'
      break
    case "square":
      sizeValue = 'min(100%, max(12px, 75%))'
      break
    case "fill":
      sizeValue = 'min(100%, max(12px, 70%))'
      break
    default:
      sizeValue = '100%'
  }
  return {
    width: sizeValue,
    height: sizeValue
  }
})
const borderRadius = computed(() => {
  switch (bgShape.value) {
    case "fill":
      return "50%"
    case "circle":
      return "50%"
    case "square":
      return `${getPadding()}px`
    default:
      return "0"
  }
})

const mixPercentage = Math.round(BACKGROUND_OPACITY * 100)
const wrapperStyle = computed(() => {
  const hasBg = bgShape.value !== "outline"
  const isFill = bgShape.value === "fill"

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: isFill ? "#fff" : color.value || "#191919",
    backgroundColor: isFill ? color.value :
      hasBg
        ? `color-mix(in srgb, currentColor ${mixPercentage}%, transparent)`
        : "transparent",
    borderRadius: borderRadius.value
  }
})
</script>

<template>
  <div :id="id" :style="wrapperStyle" class="icon-base" :class="className">
    <component 
      :is="getLucideIconComponentRef(name)" 
      :style="iconSizeStyle" 
      :color="bgShape === 'fill' ? '#fff' : color"
      :stroke-width="2"
    />
  </div>
</template>
