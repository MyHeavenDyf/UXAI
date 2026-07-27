<script setup lang="ts">
import { ElProgress } from "element-plus"
import type { ProgressNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { computed, onMounted, ref, useAttrs } from "vue"
import "./Progress.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

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

const elProgressRef = ref<InstanceType<typeof ElProgress>>()

onMounted(() => {
  const wrapper = (elProgressRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

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
    ref="elProgressRef"
    :id="id"
    :class="className"
    :percentage="value"
    :show-text="showText"
    :status="status as any"
    :color="strokeColor as any"
    :stroke-width="strokeWidth"
  />
</template>
