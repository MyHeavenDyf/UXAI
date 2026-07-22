<script setup lang="ts">
import { computed } from 'vue'
import { svgCache, getStyleValue } from '../../utils/fetchSvg'

const props = defineProps<{
  /** icon_id 用于 SVG 缓存自查找（Pattern B 消费者通过此 prop 自解析） */
  iconId?: string
  /** 直接传入 SVG HTML（Pattern A 消费者 v-bind 展开时优先使用此值） */
  svgHtml?: string
  /** 图标大小（px） */
  size?: number
  /** 图标风格类型（映射自 A2UI shape） */
  type?: 'lined' | 'filled' | 'lined-twotone' | 'filled-twotone' | 'round-bg' | 'square-bg'
  /** 图标颜色（CSS 变量数组，如 ["var(--icon-primary)"]） */
  iconColor?: string[]
}>()

// 优先使用直接传入的 svgHtml，否则从 svgCache 查找
const resolvedSvg = computed(() => {
  if (props.svgHtml) return props.svgHtml
  if (props.iconId) {
    // 根据 type 映射到对应的 styleValue 查找缓存
    let styleValue: string
    switch (props.type) {
      case 'filled': styleValue = getStyleValue('filled'); break
      case 'filled-twotone': styleValue = getStyleValue('filled'); break  // filled-twotone也用面性
      case 'round-bg': styleValue = getStyleValue('round_bottom2'); break
      case 'square-bg': styleValue = getStyleValue('square_bottom2'); break
      case 'lined-twotone': styleValue = getStyleValue('border'); break
      default: styleValue = getStyleValue('border'); break
    }

    const cacheKey = `${props.iconId}:${styleValue}`
    const cached = svgCache.get(cacheKey)
    if (cached) return cached

    // filled/round-bg/square-bg 没找到时退回 border(线性)变体
    if (styleValue !== getStyleValue('border')) {
      const borderKey = `${props.iconId}:${getStyleValue('border')}`
      return svgCache.get(borderKey) || ''
    }
    return ''
  }
  return ''
})

// 标准化 SVG：移除固定 width/height，确保 fill="currentColor" 以支持 CSS 颜色覆盖
const normalizedSvg = computed(() => {
  if (!resolvedSvg.value) return ''
  let svg = resolvedSvg.value
  // 移除固定宽高属性，让 CSS 控制尺寸
   svg = svg.replace(/(<svg[^>]*?)\s(width|height)="[^"]*"/g, '$1')
  // 将非 "none" 的 fill 替换为 currentColor，使 CSS color 生效
  svg = svg.replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"')
  return svg
})

const computedStyle = computed(() => {
  const s = props.size ?? 16
  const style: Record<string, string> = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${s}px`,
    height: `${s}px`,
  }
  // 通过 CSS color 属性设置图标颜色（SVG 内部 fill="currentColor" 会继承）
  if (props.iconColor?.[0]) {
    style.color = props.iconColor[0]
  }
  return style
})
</script>

<template>
  <span
    class="hui-svg-icon"
    :style="computedStyle"
    v-html="normalizedSvg"
  />
</template>

<style scoped>
.hui-svg-icon svg {
  width: 100%;
  height: 100%;
}
</style>
