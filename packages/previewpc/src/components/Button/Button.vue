<script setup lang="ts">
import { computed, ref } from "vue"
import { ElButton } from "element-plus"
import type { ButtonNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"

import { getLucideIconComponentRef } from "../Icon/IconBase"
import "./Button.less"

type ButtonType = "" | "default" | "primary" | "danger" | "text" | "success" | "warning" | "info"
type ButtonSize = "" | "large" | "small" | "default" | undefined

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

// 圆形纯图标按钮的 icon 尺寸 = 字体大小
const circleIconSizeEnum = {
  large: 20,
  default: 18,
  small: 14,
}

const types = [
  "",
  "default",
  "primary",
  "danger",
  "text",
  "success",
  "warning",
  "info",
  undefined,
]

const props = defineProps<A2UIComponentProps<ButtonNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue, sendAction } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const label = computed(() => resolveValue(properties.value) as string)

const type = ref<ButtonType>("")
const isLink = ref(resolveValue(properties?.types) === "link")
const color = computed(() => {
  let resColor = (resolveValue(properties?.color) as string) || ""
  // 组件内的类型色
  if (isLink.value) {
    type.value = "primary"
    return ""
  } else if (types.findIndex((item) => item === resColor) > -1) {
    type.value = resColor as ButtonType
    return ""
  }
  return resColor
})

const size = computed(() => {
  return (properties.size ? sizeEnum[properties.size] : "default") as ButtonSize
})
const iconName = computed(() => resolveValue(properties?.icon) as string)
const onlyIcon = computed(() => {
  return !label.value && iconName.value
})
// const isIconOnlyCircle = computed(() => {
//   return onlyIcon.value && shape.value.circle
// })
const iconPlacement = computed(() => properties.iconPlacement || "start")
const iconBindings = computed(() => {
  let iconColor = "currentColor"
  if (onlyIcon.value) {
    switch (type.value) {
      case "primary":
        iconColor = "var(--icon-primary)"; break;
      case "success":
        iconColor = "var(--icon-success)"; break;
      case "warning":
        iconColor = "var(--icon-warning)"; break;
      case "danger":
        iconColor = "var(--icon-error)"; break;
      case "default":
        iconColor = "var(--icon-default)"; break;
      case "info":
        iconColor = "var(--icon-default)"; break;
      default:
        iconColor = "currentColor"; break;
    }
  } 
  return {
    size: onlyIcon.value
      ? (size.value ? circleIconSizeEnum[size.value] : circleIconSizeEnum.default)
      : (size.value ? iconSizeEnum[size.value] : 16),
    color: iconColor,
    "stroke-width": 1,
    "absolute-stroke-width": true,
  }
})

const shape = computed(() => {
  return {
    circle: properties.shape === "circle",
    round: properties.shape === "round",
  }
})

const handleClick = () => {
  if (!properties?.action) return
  try {
    sendAction(properties.action)
  } catch (error) {
    console.error("Failed to execute button action:", error)
  }
}
</script>

<template>
  <ElButton
    :id="id"
    :class="[className, { 'icon-only-circle': onlyIcon }]" 
    :round="shape.round"
    :circle="shape.circle"
    :type="type"
    :color="color"
    :size="size"
    :link="isLink" 
    @click="handleClick">
    <template v-if="iconName">
      <component 
        v-if="iconPlacement === 'start'"
        :class="label ? 'mr-1' : ''"
        :is="getLucideIconComponentRef(iconName)"
        v-bind="iconBindings"
      />
      {{ label }}
      <component
        v-if="iconPlacement === 'end'"
        :class="label ? 'ml-1' : ''"
        :is="getLucideIconComponentRef(iconName)"
        v-bind="iconBindings"
      />
    </template>
    <template v-else>
      {{ label }}
    </template>
  </ElButton>
</template>
