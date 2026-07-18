<script setup lang="ts">
import { computed, onMounted, ref, useAttrs } from "vue"
import { ElRate } from "element-plus"
import type { RateNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Rate.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<RateNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const elRateRef = ref<InstanceType<typeof ElRate>>()

onMounted(() => {
  const wrapper = (elRateRef.value as any)?.$el
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

const count = computed(() => resolveValue(properties.count) as number)
const value = computed(() => resolveValue(properties.value) as number)

const allowClear = computed(() => properties?.allowClear || false)
const disabled = computed(() => properties?.disabled || false)

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : "default"
})
</script>

<template>
  <ElRate
    ref="elRateRef"
    :id="id"
    :class="className"
    :max="count"
    v-model="value"
    :clearable="allowClear"
    :disabled="disabled"
    :size="size as any"
  >
  </ElRate>
</template>
