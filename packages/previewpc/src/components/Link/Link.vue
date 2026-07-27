<script setup lang="ts">
import './Link.less'
import { ElLink } from 'element-plus'
import { useA2UIComponent } from '../../renderer/render/hooks'
import type { LinkNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import { onMounted, ref, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<LinkNode>>()
const { node, surfaceId } = props
const { text } = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const elLinkRef = ref<InstanceType<typeof ElLink>>()

onMounted(() => {
  const wrapper = (elLinkRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

const linkClassName = (node.properties as any).className ? (node.properties as any).className : ''
const textValue = resolveValue(text) || ''
const hrefValue = resolveValue((node.properties as any).href) || ''
</script>

<template>
    <ElLink ref="elLinkRef" :class="linkClassName" :href="hrefValue as string">
        {{ textValue as string }}
    </ElLink>
</template>