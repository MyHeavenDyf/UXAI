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
  if (!isBgType.value) {
    svg = svg.replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"')
  }
  return svg
})

const computedStyle = computed(() => {
  if (isBgType.value) {
    const style: Record<string, string> = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }
    if (props.iconColor?.[0]) style.color = props.iconColor[0]
    return style
  }
  const s = props.size ?? 16
  const style: Record<string, string> = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: `${s}px`, height: `${s}px` }
  if (props.iconColor?.[0]) style.color = props.iconColor[0]
  return style
})
</script>

<template>
  <span class="hui-svg-icon" :style="computedStyle" v-html="normalizedSvg" />
</template>

<style scoped>
.hui-svg-icon svg {
  width: 100%;
  height: 100%;
}
</style>
