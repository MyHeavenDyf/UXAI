<script setup lang="ts">
import { computed, onMounted, ref, useAttrs } from 'vue'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import type { ImageNode } from '../types'
import './Image.less'
import { ElImage } from 'element-plus'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<ImageNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const elImageRef = ref<InstanceType<typeof ElImage>>()

onMounted(() => {
  const wrapper = (elImageRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})


const imageUrl = computed(() => {
  console.log(properties.url, resolveValue(properties.url));
  
  return (resolveValue(properties.url) as string) || ''
})

const alt = computed(() => properties.alt)

const srcList = computed(() => {
  return properties.preview ? [imageUrl.value] : []
})

const className = computed(() => properties.className)

</script>

<template>
  <ElImage ref="elImageRef" :class="className" :src="imageUrl" :alt="alt" :preview-src-list="srcList" />

</template>