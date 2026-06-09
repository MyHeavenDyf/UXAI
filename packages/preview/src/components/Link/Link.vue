<script setup lang="ts">
import './Link.less'
import { ElLink } from 'element-plus'
import { useA2UIComponent } from '../../renderer/render/hooks'
import type { LinkNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'

const props = defineProps<A2UIComponentProps<LinkNode>>()
const { node, surfaceId } = props
const { text, className, href } = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const linkClassName = className ? className : ''
const textValue = resolveValue(text) || ''
const hrefValue = resolveValue(href) || ''
</script>

<template>
    <ElLink :class="linkClassName" :href="hrefValue as string">
        {{ textValue as string }}
    </ElLink>
</template>