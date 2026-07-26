<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import { ElSwitch } from "element-plus"
import type { SwitchNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Switch.less"
import { useIconComponentRef, createIconRenderer } from "../Icon/IconBase"

const sizeEnum = {
  medium: "default",
  small: "small",
}

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<SwitchNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const elSwitchRef = ref<InstanceType<typeof ElSwitch>>()

onMounted(() => {
  const wrapper = (elSwitchRef.value as any)?.$el
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

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})

const checkedChildren = computed(() => properties.checkedChildren)
const unCheckedChildren = computed(() => properties.unCheckedChildren)

// ---- 图标解析（使用 createIconRenderer 封装为 Element Plus 可接受的 Component） ----
const checkedIconName = computed(() => resolveValue(properties.checkedChildrenIcon) as string | undefined)
const checkedIconRef = useIconComponentRef(checkedIconName)
const checkedChildrenIcon = computed(() => createIconRenderer(checkedIconRef.value) ?? null)

const uncheckedIconName = computed(() => resolveValue(properties.unCheckedChildrenIcon) as string | undefined)
const uncheckedIconRef = useIconComponentRef(uncheckedIconName)
const unCheckedChildrenIcon = computed(() => createIconRenderer(uncheckedIconRef.value) ?? null)

const initVal = computed(() => resolveValue(properties.value) as boolean ?? false)
const value = ref(initVal.value)
watch(
  () => initVal.value,
  (newVal) => {
    value.value = newVal
  },
  { immediate: true }
)

const onSwitch = (val: string | number | boolean) => {
  const path = (properties.value as any)?.path
  if (!path) return
  setValue(path, val as boolean)
}
</script>

<template>
  <ElSwitch
    ref="elSwitchRef"
    :id="id"
    v-model="value"
    inline-prompt
    :size="size as any"
    :active-text="checkedChildren"
    :inactive-text="unCheckedChildren"
    :active-action-icon="checkedChildrenIcon as any"
    :inactive-action-icon="unCheckedChildrenIcon as any"
    @change="onSwitch"
  />
</template>
