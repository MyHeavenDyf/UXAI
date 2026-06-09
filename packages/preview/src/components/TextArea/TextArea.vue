<script setup lang="ts">
import { ref, watch, computed } from "vue"
import { ElInput } from "element-plus"
import type { TextAreaNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<TextAreaNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)
const autosize = computed(() => node.properties.autoSize)


const placeholder = computed(
  () => resolveValue(properties.placeholder) as string
)
const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})
const maxlength = computed(() => properties.maxLength)

const initVal = computed(() => resolveValue(properties.value) as string)
const value = ref(initVal.value)
watch(
  () => initVal.value,
  (newVal) => {
    value.value = newVal
  }
)

function change(val: string) {
  const path = (properties as any).text?.path
  if (!val || !path) return
  setValue(path, val)
}
</script>

<template>
  <ElInput
    :id="id"
    :class="className"
    v-model="value"
    :size="size"
    type="textarea"
    :autosize="autosize"
    :maxlength="maxlength"
    :placeholder="placeholder"
    @change="change"
  >
  </ElInput>
</template>
