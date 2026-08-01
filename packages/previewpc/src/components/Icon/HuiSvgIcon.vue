<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  svgHtml?: string
  iconUrl?: string
  size?: number
  type?: 'lined' | 'filled' | 'lined-twotone' | 'filled-twotone' | 'round-bg' | 'square-bg'
  iconColor?: string[]
}>()

const isBgType = computed(() => props.type === 'round-bg' || props.type === 'square-bg')

// 直接使用 svgHtml，不再自行查找缓存
const resolvedSvg = computed(() => props.svgHtml || '')

// 标准化：移除 <svg> 标签上的 width/height（让 CSS 控制尺寸）；非 bg 类型 fill→currentColor
const normalizedSvg = computed(() => {
  if (!resolvedSvg.value) return ''
  let svg = resolvedSvg.value
  // 分别移除 width 和 height，避免正则只匹配第一个属性的问题
  svg = svg.replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1')
  svg = svg.replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1')
  return svg
})

const computedStyle = computed(() => {
  const sizeVal = props.size ? `${props.size}px` : '100%'
  const style: Record<string, string> = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: sizeVal, height: sizeVal }
  if (isBgType.value) {
    if (props.iconColor?.[0]) style.color = props.iconColor[0]
    return style
  }
  if (props.iconColor?.[0]) style.color = props.iconColor[0]
  return style
})
</script>

<template>
  <i class="hui-svg-icon" :style="computedStyle" v-html="normalizedSvg" />
</template>

