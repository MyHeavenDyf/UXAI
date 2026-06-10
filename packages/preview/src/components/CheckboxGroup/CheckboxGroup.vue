<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { ElCheckboxGroup, ElCheckbox } from 'element-plus'
import type { CheckboxGroupNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import './CheckboxGroup.less'

const props = defineProps<A2UIComponentProps<CheckboxGroupNode>>()
const { node, surfaceId } = props

const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

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
  const path = node.properties.value?.path
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