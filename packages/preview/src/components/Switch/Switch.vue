<script setup lang="ts">
import { ref, watch, computed } from "vue"
import { ElSwitch } from "element-plus"
import type { SwitchNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Switch.less"

const sizeEnum = {
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<SwitchNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)

const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : ""
})

const checkedChildren = computed(() => properties.checkedChildren)
const unCheckedChildren = computed(() => properties.unCheckedChildren)
const checkedChildrenIcon = computed(() =>
  resolveValue(properties.checkedChildrenIcon)
)
const unCheckedChildrenIcon = computed(() =>
  resolveValue(properties.unCheckedChildrenIcon)
)

const initVal = computed(() => resolveValue(properties.value) as boolean)
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
    :id="id"
    v-model="value"
    inline-prompt
    :size="size as any"
    :active-text="checkedChildren"
    :inactive-text="unCheckedChildren"
    :active-icon="checkedChildrenIcon as any"
    :inactive-icon="unCheckedChildrenIcon as any"
    @change="onSwitch"
  />
</template>
