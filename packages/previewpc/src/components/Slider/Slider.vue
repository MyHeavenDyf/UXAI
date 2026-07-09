<script setup lang="ts">
import { ref, watch, computed } from "vue"
import { ElSlider } from "element-plus"
import type { SliderNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Slider.less"

const props = defineProps<A2UIComponentProps<SliderNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const initVal = computed(() => resolveValue(properties.value as any) as number)
const value = ref(initVal.value)
const minValue = computed(() => (resolveValue(properties.min as any) ?? 0) as number)
const maxValue = computed(() => (resolveValue(properties.max as any) ?? 100) as number)
const step = computed(() => (resolveValue(properties.step as any) ?? 1) as number)
const range = computed(() => resolveValue(properties.range as any) as boolean)
const input = computed(() => resolveValue(properties.input as any) as boolean)
const vertical = computed(
  () => resolveValue(properties.orientation as any) === "vertical"
)
const marks = computed(() => {
  if (properties.marks?.hasOwnProperty("path")) {
    return resolveValue(properties.marks as any)
  }

  return properties.marks
})

watch(
  () => initVal.value,
  (newVal) => {
    value.value = newVal
  }
)

function onChange(val: number | number[]) {
  const path = (properties.value as any)?.path
  if (val === undefined || val === null || !path) return
  setValue(path, val)
}
</script>

<template>
  <ElSlider
    :id="id"
    :class="className"
    v-model="value"
    :min="minValue"
    :max="maxValue"
    :range="range"
    :step="step"
    :vertical="vertical"
    :show-input="input"
    :show-tooltip="true"
    :marks="marks as any"
    @change="onChange"
  />
</template>
