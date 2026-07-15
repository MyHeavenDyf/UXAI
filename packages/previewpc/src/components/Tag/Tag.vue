<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ElTag } from "element-plus"

import { getIconComponentRef } from "../Icon/IconBase"
import type { Component } from "vue"
import type { TagNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Tag.less"
import { useTheme } from "../../composables/useTheme"

const { isDark } = useTheme()
const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const iconSizeEnum = {
  large: 16,
  default: 14,
  small: 12,
}

const effectEnum = {
  filled: "light",
  solid: "dark",
  outlined: "dark"
  // outlined: "plain",
}

const typeEnum = {
  primary: "primary",
  success: "success",
  info: "info",
  warning: "warning",
  error: "danger",
  processing: "processing",
  default: "default",
}
const types = ["success", "processing", "error", "warning", "primary", "info", "default"]


const colorsFilledTags = [
  { text: '#1f55b5', bg: 'rgb(from #d0d8fd r g b / 0.5)' },
  { text: '#036142', bg: 'rgb(from #bcf2db r g b / 0.6)' },
  { text: '#614500', bg: 'rgb(from #fde55c r g b / 0.6)' },
  { text: '#954304', bg: '#fde2bd' },
  { text: '#c7000b', bg: '#fee7e8' },
  { text: '#393939', bg: 'rgb(from #191919 r g b / 0.05)' },
  { text: '#281675', bg: 'rgb(from #d5d3fd r g b / 0.6)' },
  { text: '#9f1c8d', bg: '#fde6fc' },
  { text: '#036142', bg: '#dff4cc' },
  { text: '#c40054', bg: '#fee5f2' },
  { text: '#094c57', bg: 'rgb(from #1c94a4 r g b / 0.15)' },
  { text: '#8a2ebc', bg: 'rgb(from #e8cffe r g b / 0.6)' },
  { text: '#004ea8', bg: '#e6f2fd' },
  { text: '#8ca3fa', bg: 'rgb(from #668cf7 r g b / 0.15)', isDark: true },
  { text: '#36c18d', bg: 'rgb(from #09aa71 r g b / 0.15)', isDark: true },
  { text: '#fcc800', bg: 'rgb(from #fde55c r g b / 0.15)', isDark: true },
  { text: '#f69e39', bg: 'rgb(from #f4840c r g b / 0.15)', isDark: true },
  { text: '#e7434a', bg: 'rgb(from #ee696f r g b / 0.15)', isDark: true },
  { text: '#aeaeae', bg: 'rgb(from #aeaeae r g b / 0.15)', isDark: true },
  { text: '#a89ff9', bg: 'rgb(from #a89ff9 r g b / 0.15)', isDark: true },
  { text: '#eb74df', bg: 'rgb(from #eb74df r g b / 0.15)', isDark: true },
  { text: '#36c18d', bg: 'rgb(from #87c859 r g b / 0.15)', isDark: true },
  { text: '#f470ab', bg: 'rgb(from #f470ab r g b / 0.15)', isDark: true },
  { text: '#55ccd9', bg: 'rgb(from #2cb8c9 r g b / 0.15)', isDark: true },
  { text: '#cb8efb', bg: 'rgb(from #cb8efb r g b / 0.15)', isDark: true },
  { text: '#5ca2e9', bg: 'rgb(from #5ca2e9 r g b / 0.15)', isDark: true },
]
/**
 * 根据背景色计算文字颜色（支持单词、Hex、RGB、HSL 等所有合法 CSS）
 * @param {String} color - 传入的背景颜色
 * @returns {String} '#000000' 或 '#FFFFFF'
 */
const getContrastColor = (color: string) => {
  if (!color) return "#FFFFFF" // 没颜色时默认给白色
  let r, g, b, a
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return "#FFFFFF"
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
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
const iconSize = computed(() => (size.value ? iconSizeEnum[size.value as keyof typeof iconSizeEnum] : 12))

const resolvedIcon = ref<{ component: Component | null; props: Record<string, any> } | null>(null)
watch(
  [iconName, iconSize],
  async ([name, sz]) => {
    if (!name) { resolvedIcon.value = null; return }
    resolvedIcon.value = await getIconComponentRef(name, { size: sz })
  },
  { immediate: true },
)

const effect = computed(() => {
  if (type.value === "default") return "light"
  const variant = resolveValue(properties?.variant as any) as string
  return variant ? effectEnum[variant as keyof typeof effectEnum] : "light"
})

const type = ref<string | undefined>(undefined)
const color = ref("")
const styles = ref<Record<string, string>>({})
watch(
  [() => properties?.color,()=>isDark.value],
  ([curColor, curDark]) => {
    
    if (!curColor) return false
    const newColor = resolveValue(curColor) as string
    // 组件内的类型色
    if (types.findIndex((item) => item === newColor) > -1) {
      type.value = typeEnum[newColor as keyof typeof typeEnum]
      return false
    }
    // 自定义颜色
    // 按规范修改outlined(plain)和solid(dark)一致
    if (effect.value === "plain" || effect.value === "dark") {
      styles.value = {
        "--el-tag-bg-color": newColor,
        "--el-tag-border-color": "transparent",
        "--el-tag-text-color": getContrastColor(newColor),
      }
    } else {
      const presetObj = colorsFilledTags.find(item => !!item.isDark === curDark && item.text === newColor)
      const bgColor = presetObj?.bg ?? `color-mix(in oklch, ${newColor} 10%, white)`
      styles.value = {
        "--el-tag-bg-color": bgColor,
        "--el-tag-border-color": "transparent",
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
  :class="[className, (type ==='default' || type==='processing') ? `el-tag--${type}`:'']" 
  :size="size as any" 
  :closable="closable"
  :effect="effect as any" 
  :type="(type ==='default' || type==='processing') ? undefined : type as any" 
  :color="color" 
  :style="styles">
    <template v-if="iconName && resolvedIcon?.component">
      <span :class="label ? 'mr-1' : ''">
        <component :is="resolvedIcon.component" v-bind="resolvedIcon.props" />
      </span>
    </template>
    {{ label }}
  </ElTag>
</template>
