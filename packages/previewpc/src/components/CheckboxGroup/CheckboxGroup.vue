<script setup lang="ts">
import { ref, computed, onMounted, useAttrs } from 'vue'
import { ElCheckboxGroup, ElCheckbox } from 'element-plus'
import type { CheckboxGroupNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<CheckboxGroupNode>>()
const { node, surfaceId } = props

const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const elCheckboxGroupRef = ref<InstanceType<typeof ElCheckboxGroup>>()

onMounted(() => {
  const wrapper = (elCheckboxGroupRef.value as any)?.$el
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

const data = computed(() => {
  const opts = node.properties.options
  if (Array.isArray(opts)) {
    return opts
  }
  return resolveValue(opts) as []
})


const initVal = computed(() => (resolveValue(node.properties.value) as []) || [])
const checked = ref<any[]>(initVal.value)

onMounted(() => {
  if (initVal.value.length) {
    handleChange(initVal.value)
  }
})

function handleChange(value: any[]) {
  const path = (node.properties.value as any)?.path
  if (!path) return
  const labels = value.map((val) => {
    const temp = data.value.find((i: any) => i.value === val)
    return temp?.label || ''
  })
  setValue(path, labels)
}
</script>

<template>
  <ElCheckboxGroup 
    ref="elCheckboxGroupRef"
    :id="id" 
    v-model="checked" 
    :class="className"
    @change="handleChange">
    <ElCheckbox 
      v-for="item in data" 
      :key="item.value" 
      :value="item.value" 
      :label="item.label" />
  </ElCheckboxGroup>
</template>