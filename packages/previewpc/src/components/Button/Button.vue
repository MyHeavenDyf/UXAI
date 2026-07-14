<script setup lang="ts">
import { computed, ref } from "vue"
import { ElButton } from "element-plus"
import type { ButtonNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { useIconComponentRef } from "../Icon/IconBase"
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
const iconPlacement = computed(() => properties.iconPlacement || "start")

// ---- 异步图标解析 ----
function resolveIconColorForType(): string {
  if (!onlyIcon.value) return "currentColor"
  switch (type.value) {
    case "primary":  return "var(--icon-primary)"
    case "success":  return "var(--icon-success)"
    case "warning":  return "var(--icon-warning)"
    case "danger":   return "var(--icon-error)"
    case "default":  return "var(--icon-default)"
    case "info":     return "var(--icon-default)"
    default:         return "currentColor"
  }
}

function resolveIconSize(): number {
  if (onlyIcon.value) {
    return size.value ? circleIconSizeEnum[size.value] : circleIconSizeEnum.default
  }
  return size.value ? iconSizeEnum[size.value] : 16
}

const iconNameForRef = computed(() => {
  const name = resolveValue(properties?.icon) as string
  return name || undefined
})
const baseIconRef = useIconComponentRef(iconNameForRef, { strokeWidth: 1 })

const resolvedIcon = computed(() => {
  if (!baseIconRef.value?.component || !iconName.value) return null
  const base = baseIconRef.value
  const isHui = "iconColor" in base.props
  const colorValue = resolveIconColorForType()
  return {
    component: base.component,
    props: isHui
      ? { size: resolveIconSize(), type: base.props.type, iconColor: [colorValue] }
      : { size: resolveIconSize(), color: colorValue, "stroke-width": 1 },
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
    <template v-if="iconName && resolvedIcon">
      <component 
        v-if="iconPlacement === 'start'"
        :class="label ? 'mr-1' : ''"
        :is="resolvedIcon.component"
        v-bind="resolvedIcon.props"
      />
      {{ label }}
      <component
        v-if="iconPlacement === 'end'"
        :class="label ? 'ml-1' : ''"
        :is="resolvedIcon.component"
        v-bind="resolvedIcon.props"
      />
    </template>
    <template v-else>
      {{ label }}
    </template>
  </ElButton>
</template>
