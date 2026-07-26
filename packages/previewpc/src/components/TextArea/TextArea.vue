<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import { ElInput } from "element-plus"
import type { TextAreaNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./TextArea.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<TextAreaNode>>()
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
    ref="elInputRef"
    :class="className"
    v-model="value"
    :size="size as any"
    type="textarea"
    :show-word-limit="true"
    :autosize="autosize"
    :maxlength="maxlength"
    :placeholder="placeholder"
    @change="change"
  >
  </ElInput>
</template>
