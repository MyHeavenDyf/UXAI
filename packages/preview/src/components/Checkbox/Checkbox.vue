<script setup lang="ts">
import { ref, computed } from 'vue'
import {  ElCheckbox } from 'element-plus'
import type { CheckboxNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import ComponentNode from "../../renderer/render/ComponentNode.vue"


const props = defineProps<A2UIComponentProps<CheckboxNode>>()
const { node, surfaceId } = props

const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

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