<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ElTag } from "element-plus"

import { getLucideIconComponentRef } from "../Icon/IconBase"
import type { TagNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Tag.less"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const iconSizeEnum = {
  large: 16,
  default:14,
  small: 12,
}

const effectEnum = {
  filled: "light",
  solid: "dark",
  outlined: "plain",
}

const typeEnum = {
  success: "success",
  processing: "primary",
  error: "danger",
  default: "info", 
  warning: "warning",
}
const types = ["success", "processing", "error", "default", "warning"]

/**
 * 根据背景色计算文字颜色（支持单词、Hex、RGB、HSL 等所有合法 CSS）
 * @param {String} color - 传入的背景颜色
 * @returns {String} '#000000' 或 '#FFFFFF'
 */
const getContrastColor = (color: string) => {
  if (!color) return "#FFFFFF" // 没颜色时默认给白色
  let r, g, b, a
  try {
    // 1. 利用 Canvas 解析任何合法的 CSS 颜色字符串
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    // 把背景色画在 1x1 像素的画布上
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    // 读取这个像素的 r, g, b, a 值
    const imageData = ctx.getImageData(0, 0, 1, 1).data
    r = imageData[0]
    g = imageData[1]
    b = imageData[2]
    a = imageData[3]
    if (a === 0) return "#000000"
  } catch (e) {
    return "#FFFFFF"
  }
  // 2. 使用 YIQ 亮度公式
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  // 3. 偏向白色文字的阈值设定
  return yiq >= 180 ? "#000000" : "#FFFFFF"
}

const props = defineProps<A2UIComponentProps<TagNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => props.node.id)
const className = computed(() => properties.className)

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})

const label = computed(() => {
  return (resolveValue(properties.value) as string) ?? ""
})

const closable = computed(() => properties?.closable)
// const closeIcon = computed(() => properties?.closeIcon)

const iconName = computed(() => resolveValue(properties?.icon) as string)
const iconSize = computed(() => (size.value ? iconSizeEnum[size.value] : 12))

const effect = computed(() => {
  const variant = resolveValue(properties?.variant)
  return variant ? effectEnum[variant] : "light"
})

const type = ref(undefined)
const color = ref("")
const styles = ref({})
watch(
  () => properties?.color,
  (curColor) => {
    if (!curColor) return false
    const newColor = resolveValue(curColor) as string
    // 组件内的类型色
    if (types.findIndex((item) => item === newColor) > -1) {
      type.value = typeEnum[newColor]
      return false
    }
    // 自定义颜色
   
    if (effect.value === "plain") {
      styles.value = {
        "--el-tag-bg-color": "#fff",
        "--el-tag-border-color": newColor,
        "--el-tag-text-color": newColor,
      }
    } else if (effect.value === "dark") {
      styles.value = {
        "--el-tag-bg-color": newColor,
        "--el-tag-border-color": newColor,
        "--el-tag-text-color": getContrastColor(newColor),
      }
    } else {
      styles.value = {
        "--el-tag-bg-color": `color-mix(in oklch, ${newColor} 10%, white)`,
        "--el-tag-border-color": `color-mix(in oklch, ${newColor} 20%, white)`,
        "--el-tag-text-color": newColor,
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <ElTag
    v-show="label !== ''"
    :id="id"
    :class="className"
    :size="size"
    :closable="closable"
    :effect="effect"
    :type="type"
    :color="color"
    :style="styles"
  >
    <template v-if="iconName">
      <span :class="label ? 'mr-1' : ''">
        <component
          :is="getLucideIconComponentRef(iconName)"
          :size="iconSize"
        />
      </span>
    </template>
    {{ label }}
  </ElTag>
</template>
