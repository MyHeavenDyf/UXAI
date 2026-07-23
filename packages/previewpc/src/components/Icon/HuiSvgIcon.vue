<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 直接传入 SVG HTML（由父组件通过 variantDataMap.svgContent 提供） */
  svgHtml?: string
  /** 图标 url（保留用于调试，渲染不再依赖此值） */
  iconUrl?: string
  /** 图标大小（px），不传则根据type决定：round-bg/square-bg填满父容器，其他默认16 */
  size?: number
  /** 图标风格类型（映射自 A2UI shape） */
  type?: 'lined' | 'filled' | 'lined-twotone' | 'filled-twotone' | 'round-bg' | 'square-bg'
  /** 图标颜色（CSS 变量数组，如 ["var(--icon-primary)"]） */
  iconColor?: string[]
}>()

// 是否为自带背景的类型（圆底托/方底托）
const isBgType = computed(() => props.type === 'round-bg' || props.type === 'square-bg')

// 直接使用 svgHtml prop — 不再自行查找 svgCache
const resolvedSvg = computed(() => props.svgHtml || '')

// 标准化 SVG：
// - 移除固定 width/height（让CSS控制尺寸）
// - round-bg/square-bg 类型：不替换 fill，保留API返回的原始颜色（托底背景+图标前景有不同颜色）
// - 其他类型：将非 "none" 的 fill 替换为 currentColor，使 CSS color 生效
const normalizedSvg = computed(() => {
  if (!resolvedSvg.value) return ''
  let svg = resolvedSvg.value
  // 移除固定宽高属性，让 CSS 控制尺寸
  svg = svg.replace(/(<svg[^>]*?)\s(width|height)="[^"]*"/g, '$1')
  // 仅对非自带背景类型替换fill为currentColor
  if (!isBgType.value) {
    svg = svg.replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"')
  }
  return svg
})

const computedStyle = computed(() => {
  // 圆底托/方底托：填满父容器，不设固定px
  if (isBgType.value) {
    const style: Record<string, string> = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
    }
    if (props.iconColor?.[0]) {
      style.color = props.iconColor[0]
    }
    return style
  }

  // 其他类型：使用显式px尺寸
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
