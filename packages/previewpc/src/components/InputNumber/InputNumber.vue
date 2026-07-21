<script setup lang="ts">
import { onMounted, ref, computed, useAttrs } from "vue"
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

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elInputNumberRef = ref<InstanceType<typeof ElInputNumber>>()

onMounted(() => {
  const wrapper = (elInputNumberRef.value as any)?.$el
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

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})
const placeholder = computed(
  () => resolveValue(properties.placeholder) as string
)
const controls = computed(() =>
typeof properties.controls === "boolean"
    ? properties.controls
    : (properties.controls ? resolveValue(properties.controls) : true)
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
    ref="elInputNumberRef"
    :id="id"
    :class="className"
    v-model="val"
    :min="minVal"
    :max="maxVal"
    :step="stepVal"
    :size="size as any"
    :controls="controls as boolean"
    :placeholder="placeholder"
    @change="change"
  />
</template>
