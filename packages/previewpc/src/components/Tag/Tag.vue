<script setup lang="ts">
import { computed, onMounted, ref, useAttrs, watch } from "vue"
import { ElTag } from "element-plus"

import { useIconComponentRef } from "../Icon/IconBase"
import type { TagNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Tag.less"
import { useTheme } from "../../composables/useTheme"
import {tagColors, tagDarkColors, themeColors} from "../../utils/themeColors"

const { isDark } = useTheme()
const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const iconSizeEnum = {
  large: 12,
  default: 10,
  small: 10,
}

const effectEnum = {
  filled: "light",
  solid: "dark",
  outlined: "dark"
  // outlined: "plain",
}

const props = defineProps<A2UIComponentProps<TagNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elTagRef = ref<InstanceType<typeof ElTag>>()

onMounted(() => {
  const wrapper = (elTagRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

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
const iconSize = computed(() => (size.value ? iconSizeEnum[size.value as keyof typeof iconSizeEnum] : 10))

const iconColor = ref("#191919")
const resolvedIcon = useIconComponentRef(iconName, computed(() => ({
  shape: 'lined',
  color: iconColor.value,
  size: iconSize.value
})))

const variant = computed(() => resolveValue(properties?.variant as any) as string || 'filled')
const effect = computed(() => {
  return variant.value ? effectEnum[variant.value as keyof typeof effectEnum] : "light"
})

const type = ref<string | undefined>(undefined)
const color = ref("")
const styles = ref<Record<string, string>>({})
watch(
  [() => properties?.color,()=>isDark.value],
  ([curColor]) => {
    const newColor = (resolveValue(curColor) as string) ?? 'default'
    type.value = newColor
    const currentTagColors = isDark.value ? tagDarkColors : tagColors
    const typeColors = currentTagColors[variant.value as keyof typeof currentTagColors] || {}
    const colorObj = typeColors[newColor as keyof typeof typeColors]
    const {text, bg, bgOpacity } = colorObj ?? currentTagColors.filled.default
    const hex = (themeColors as Record<string, string>)[text]
    iconColor.value = hex
    styles.value = {
      "--el-tag-bg-color": bgOpacity ? `rgb(from var(${bg}) r g b / ${bgOpacity})` : `var(${bg})`,
      "--el-tag-border-color": "transparent",
      "--el-tag-text-color": `var(${text})`
    }
  },
  { immediate: true }
)
</script>

<template>
  <ElTag ref="elTagRef" 
  v-show="label !== ''" 
  :id="id" 
  :class="[className,`el-tag--${type}`]" 
  :size="size as any" 
  :closable="closable"
  :effect="effect as any" 
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
