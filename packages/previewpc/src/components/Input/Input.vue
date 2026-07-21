<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import { ElInput } from "element-plus"
import type { InputNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { useIconComponentRef } from "../Icon/IconBase"
import "./Input.less"

defineOptions({ inheritAttrs: false })

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const attrs = useAttrs()
const props = defineProps<A2UIComponentProps<InputNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const elInputRef = ref<InstanceType<typeof ElInput>>()

onMounted(() => {
  const wrapper = (elInputRef.value as any)?.$el
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

const resolvedPrefix = useIconComponentRef(prefix, { size: 14 })
const resolvedSuffix = useIconComponentRef(suffix, { size: 14 })

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
    ref="elInputRef"
    :id="id"
    :class="className"
    v-model="value"
    :size="size as any"
    :type="type"
    :maxlength="maxlength as any"
    :placeholder="placeholder"
    :show-password="type==='password'"
    @change="change"
  >
    <template v-if="prefix && resolvedPrefix?.component" #prefix>
      <component :is="resolvedPrefix.component" v-bind="resolvedPrefix.props" />
    </template>
    <template v-if="suffix && resolvedSuffix?.component" #suffix>
      <component :is="resolvedSuffix.component" v-bind="resolvedSuffix.props" />
    </template>
  </ElInput>
</template>
