<script setup lang="ts">
import { ElProgress } from "element-plus"
import type { ProgressNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { computed } from "vue"
import "./Progress.less"
const statusEnum = {
  success: "success",
  exception: "exception",
  normal: "",
  active: "",
}
const props = defineProps<A2UIComponentProps<ProgressNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const value = computed(() => resolveValue(properties.percent) as number)

const showText = computed(() => properties.showInfo)
const status = computed(() => {
  const resStatus = resolveValue(properties.status as any) as string
  return resStatus ? statusEnum[resStatus as keyof typeof statusEnum] : ""
})
const strokeColor = computed(() => resolveValue(properties.strokeColor) ?? undefined)
const strokeWidth = computed(() => {
  const size = resolveValue(properties.size)
  let width = 8
  switch (size) {
    case "medium":
      width = 8
      break
    default:
      width = 8
      break
  }
  return width
})
</script>

<template>
  <ElProgress
    :id="id"
    :class="className"
    :percentage="value"
    :show-text="showText"
    :status="status as any"
    :color="strokeColor as any"
    :stroke-width="strokeWidth"
  />
</template>
