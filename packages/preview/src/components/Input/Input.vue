<script setup lang="ts">
import { ref, watch, computed } from "vue"
import { ElInput } from "element-plus"
import type { InputNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getLucideIconComponentRef } from "../Icon/IconBase"
import "./Input.less"
const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<InputNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const type = computed(() => (properties.password ? "password" : ""))
const placeholder = computed(
  () => resolveValue(properties.placeholder) as string
)
const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})
const maxlength = computed(() => resolveValue(properties.maxLength))
const suffix = computed(() => resolveValue(properties.suffix) as string)
const prefix = computed(() => resolveValue(properties.prefix) as string)

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
    :size="size as any"
    :type="type"
    :maxlength="maxlength as any"
    :placeholder="placeholder"
    @change="change"
  >
    <template v-if="prefix" #prefix>
      <component :is="getLucideIconComponentRef(prefix)" :size="16" />
    </template>
    <template v-if="suffix" #suffix>
      <component :is="getLucideIconComponentRef(suffix)" :size="16" />
    </template>
  </ElInput>
</template>
