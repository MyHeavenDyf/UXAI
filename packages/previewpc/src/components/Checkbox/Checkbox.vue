<script setup lang="ts">
import { ref, computed, onMounted, useAttrs } from 'vue'
import {  ElCheckbox } from 'element-plus'
import type { CheckboxNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import ComponentNode from "../../renderer/render/ComponentNode.vue"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<CheckboxNode>>()
const { node, surfaceId } = props

const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const elCheckboxRef = ref<InstanceType<typeof ElCheckbox>>()

onMounted(() => {
  const wrapper = (elCheckboxRef.value as any)?.$el
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




const disabled = computed(() => (resolveValue(node.properties.disabled) as boolean) || false)
const label = computed(() => (resolveValue(node.properties.label) as string))
const initVal = computed(() => (resolveValue(node.properties.checked) as boolean) || false)
const checked = ref<boolean>(initVal.value)

const children = computed(() => {
  return node.properties.children || []
})

function handleChange(value: any) {
  const path = (node.properties.checked as any)?.path
  if (!path) return

  setValue(path, value)
}
</script>

<template>
  <ElCheckbox
    ref="elCheckboxRef"
    :id="id" 
    v-model="checked" 
    :disabled="disabled"
    :class="className"
    @change="handleChange">
    <template v-if="children.length === 0">{{ label }}</template>
    <template v-else v-for="(child, index) in children" :key="index">
      <ComponentNode :node="child" :surfaceId="surfaceId" />
    </template>
  </ElCheckbox>

</template>