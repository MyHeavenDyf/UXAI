<script setup lang="ts">
import { ref, watch, computed } from "vue"
import { ElTimePicker } from "element-plus"
import type { TimePickerNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./TimePicker.less"
const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<TimePickerNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : "default"
})
const format = computed(() => properties.format)

const range = computed(() => resolveValue(properties.range as any) as boolean)

const placeholder = computed(() => {
  const ph = resolveValue(properties.placeholder as any)
  if (range.value) {
    if (Array.isArray(ph)) {
      return { start: ph[0], end: ph[1] } as any
    }
    return { start: "", end: "" } as any
  }
  return (ph as string) || ""
})

const initValue = computed(() => {
  const parsed = resolveValue(properties.value as any)
  return parsed
})
const inputValue = ref<any>(initValue.value)
watch(
  () => initValue.value,
  (newVal) => {
    inputValue.value = newVal
  }
)

function handleDateChange(val: any) {
  const path = (properties.value as any)?.path
  if (!path) return
  setValue(path, val)
}
</script>

<template>
  <ElTimePicker
    :id="id"
    :class="className"
    v-model="inputValue"
    :placeholder="range ? placeholder : undefined"
    :start-placeholder="range ? placeholder?.start : undefined"
    :end-placeholder="range ? placeholder?.end : undefined"
    :is-range="range"
    :size="size as any"
    :format="format"
    @change="handleDateChange"
  />
</template>
