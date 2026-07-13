<script setup lang="ts">
import { computed } from 'vue'
import type { A2UIComponentProps } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import type { ImageNode } from '../types'
import './Image.less'
import { ElImage } from 'element-plus'


const props = defineProps<A2UIComponentProps<ImageNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)


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
  <ElImage :class="className" :src="imageUrl" :alt="alt" :preview-src-list="srcList" />

</template>