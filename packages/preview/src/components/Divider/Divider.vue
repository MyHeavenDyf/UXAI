<script setup lang="ts">
import { ElDivider, type DividerProps } from "element-plus"
import type { DividerNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"
import "./Divider.less"
import { computed } from "vue"
import ComponentNode from "../../renderer/render/ComponentNode.vue"

const positionEnum = {
  start: "left",
  end: "right",
  center: "center",
}

const props = defineProps<A2UIComponentProps<DividerNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className)

const value = computed(() => resolveValue(properties.value))
const orientation = computed(() => properties.orientation)
const titlePlacement = computed(() => {
  const placement = properties.titlePlacement
  return (
    placement ? positionEnum[placement] : undefined
  ) as DividerProps["contentPosition"]
})
const variant = computed(() => properties.variant)

const styles = computed(() => {
  const size = properties.size
  const isVertical = orientation.value === "vertical"
  let margin = "24px 0"
  switch (size) {
    case "small":
      margin = isVertical ? "0 8px" : "8px 0"
      break
    case "medium":
      margin = isVertical ? "0 16px" : "16px 0"
      break
    default:
      margin = isVertical ? "0 24px" : "24px 0"
      break
  }

  return { margin }
})
</script>

<template>
  <ElDivider
    :id="id"
    :class="className"
    :style="styles"
    :direction="orientation"
    :border-style="variant"
    :content-position="titlePlacement"
  >
    <template v-if="typeof value === 'string'">
      {{ value }}
    </template>
    <ComponentNode
      v-else-if="value !== undefined"
      :node="value"
      :surface-id="surfaceId"
    />
  </ElDivider>
</template>
