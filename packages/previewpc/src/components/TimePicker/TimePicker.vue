<script setup lang="ts">
import { onMounted, ref, watch, computed, useAttrs } from "vue"
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

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elTimePickerRef = ref<InstanceType<typeof ElTimePicker>>()

onMounted(() => {
  const wrapper = (elTimePickerRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

const id = computed(() => node.id as string)
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
    ref="elTimePickerRef"
    :id="range ? [id+'-1', id+'-2'] : id"
    :class="className"
    v-model="inputValue"
    :placeholder="range ? undefined : placeholder"
    :start-placeholder="range ? placeholder?.start : undefined"
    :end-placeholder="range ? placeholder?.end : undefined"
    :is-range="range"
    :size="size as any"
    :format="format"
    @change="handleDateChange"
  />
</template>
