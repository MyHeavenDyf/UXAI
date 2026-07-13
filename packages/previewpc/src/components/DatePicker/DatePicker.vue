<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElDatePicker } from 'element-plus'
import type { DatePickerNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import "./DatePicker.less"

const sizeEnum = {
  large:'large',
  medium: 'default',
  small: 'small'
}
const pickerEnum = {
  date: 'date',
  month: 'month',
  week: 'week',
  year: 'year',
  quarter: '',
  daterange: 'daterange',
  weekrange: '',
  monthrange: 'monthrange',
  yearrange: 'yearrange',
  quarterrange: '',
}



const props = defineProps<A2UIComponentProps<DatePickerNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const className = computed(() => node.properties.className)


const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : 'default'
})
const format = computed(() => properties.format)

const range = computed(() => resolveValue(properties.range))
const id = computed(() => range.value ? [`${node.id}-start`, `${node.id}-end`] : node.id)


const picker = computed(() => {
  if (range.value) {
    return properties.picker ? pickerEnum[`${properties.picker}range`] : 'daterange'
  }
  return properties.picker ? pickerEnum[properties.picker] : 'date'
})

const placeholderBinding = computed(() => {
  const ph = resolveValue(properties.placeholder as any)
  if (range.value) {
    if (Array.isArray(ph)) {
      return { 'start-placeholder': ph[0], 'end-placeholder': ph[1] } as any
    }
  } else if (ph as string) {
    return {
      placeholder: ph
    } as any

  }
  return {} as any
})

const initValue = computed(() => {
  const parsed = resolveValue(properties.value as any)
  return parsed
})
const inputValue = ref<any>(initValue.value)


function handleDateChange(val: any) {
  const path = (properties.value as any)?.path
  if (!path) return
  setValue(path, val)
}
</script>

<template>
  <ElDatePicker 
    :id="id as any"
    :class="className"
    v-model="inputValue" 
    v-bind="placeholderBinding"
    :type="picker as any"
    :size="size as any"
    :format="format" 
    @change="handleDateChange" />
</template>