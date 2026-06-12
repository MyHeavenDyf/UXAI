<script setup lang="ts">
import { ref, computed } from "vue"
import { ElInputNumber } from "element-plus"
import type { InputNumberNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./InputNumber.less"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<InputNumberNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)
const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})
const placeholder = computed(
  () => resolveValue(properties.placeholder) as string
)
const controls = computed(() =>
  properties.controls ? resolveValue(properties.controls) : true
)

const initVal = computed(() => resolveValue(properties.value) as number)
const val = ref(initVal.value)


const minVal = computed(() => (resolveValue(properties.min) as number) ?? 0)
const maxVal = computed(() => (resolveValue(properties.max) as number) ?? 100)
const stepVal = computed(() => (resolveValue(properties.step) as number) ?? 1)

function change(newVal: number | undefined) {
  const path = (properties.value as any)?.path
  if (!path) return
  setValue(path, newVal ?? 0)
}
</script>

<template>
  <ElInputNumber
    :id="id"
    :class="className"
    v-model="val"
    :min="minVal"
    :max="maxVal"
    :step="stepVal"
    :size="size as any"
    :controls="controls as any"
    :placeholder="placeholder"
    @change="change"
  />
</template>
