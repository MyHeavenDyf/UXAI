<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue"
import { ElSelect, ElOption } from "element-plus"
import type { SelectNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Select.less"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<SelectNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const placeholder = computed(
  () => resolveValue(properties.placeholder) as string
)
const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})
const multiple = computed(() => properties.mode === "multiple")
const filterable = computed(() => properties.showSearch)

const options = computed(() => {
  const opts = node.properties.options
  if (Array.isArray(opts)) {
    return opts.map((item) => {
      return {
        value: resolveValue(item.value),
        label: resolveValue(item.label),
      }
    })
  }
  return resolveValue(opts) as []
})

const initVal = computed(() => resolveValue(properties.value))
const selectValue = ref(initVal.value)

onMounted(() => {
  handleChange(initVal.value)
})

function handleChange(value: any) {
  const path = properties.value?.path
  if (!path) return
  const temp = options.value?.find((i: any) => i.value === value)
  setValue(path, temp?.label || "")
}
</script>

<template>
  <ElSelect
    :id="id"
    :class="className"
    :size="size"
    :multiple="multiple"
    :filterable="filterable"
    :placeholder="placeholder"
    v-model="selectValue"
    @change="handleChange"
  >
    <ElOption
      v-for="item in options"
      :key="item.value"
      :value="item.value"
      :label="item.label"
    />
  </ElSelect>
</template>
