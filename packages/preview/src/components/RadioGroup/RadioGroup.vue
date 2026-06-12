<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { ElRadioGroup, ElRadio, ElRadioButton } from "element-plus"
import type { RadioGroupNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import './RadioGroup.less'

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}
const typeEnum = {
  default: "radio",
  button: "button",
}

const props = defineProps<A2UIComponentProps<RadioGroupNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => {
  let classes = properties.className || ''
  if (properties.orientation === 'vertical') {
    classes = classes + ' radio-roup-vertical' 
  }
  return classes
})
const size = computed(() => {
  const resSize = resolveValue(properties.size) as string
  return resSize ? sizeEnum[resSize as keyof typeof sizeEnum] : ""
})
const type = computed(() => {
  const optionType = resolveValue(properties.optionType) as string
  return optionType ? typeEnum[optionType as keyof typeof typeEnum] : "radio"
})

const data = computed(() => {
  const opts = props.node.properties.options
  if (Array.isArray(opts)) {
    return opts
  }
  return resolveValue(opts) as []
})

const initVal = computed(() => resolveValue(node.properties.value) as string)

const selectedValue = ref(initVal.value)

onMounted(() => {
  if (initVal.value) {
    handleChange(initVal.value)
  }
})

function handleChange(value: any) {
  const path = (properties.value as any)?.path
  if (!path) return
  const item = data.value.find((i: any) => i.value === value)
  setValue(path, item?.label || "")
}
</script>

<template>
  <ElRadioGroup
    :id="id"
    :class="className"
    :size="size as any"
    v-model="selectedValue"
    @change="handleChange"
  >
    <template v-if="type === 'button'"> 
      <ElRadioButton 
        v-for="item in data"
        :key="item.value"
        :value="item.value"
        :label="item.label"
      />
    </template>
    <template v-else>
      <ElRadio
        v-for="item in data"
        :key="item.value"
        :value="item.value"
        :label="item.label"
      />
    </template>
  </ElRadioGroup>
</template>
