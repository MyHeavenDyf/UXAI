<script setup lang="ts">
import { computed } from 'vue'
import type { StreamNode } from '../types'
import type { A2UIComponentProps } from '../../renderer'
import './Stream.less'

const props = defineProps<A2UIComponentProps<StreamNode>>()

const className = computed(() => {
    const { node: { isCommon, properties } } = props
    if (isCommon) {
        const { type } = properties
        if (type === 'Column') return 'column-child-skeleton'
        if (type === 'Row') return 'row-child-skeleton'
        if (type === 'Grid') return 'grid-child-skeleton'
        if (type === 'List') return 'list-child-skeleton'
        if (type === 'Steps') return 'steps-child-skeleton'
        if (type === 'Card') return 'card-child-skeleton'
        if (type === 'Tabs') return 'tabs-child-skeleton'
        if (type === 'Collapse') return 'accordion-child-skeleton'
    } else {
        const { type } = properties
        if (type === 'Text') return 'text-skeleton'
        if (type === 'Image') return 'image-skeleton'
        if (type === 'Button') return 'button-skeleton'
        if (type === 'Icon') return 'icon-skeleton'
    }
    return 'skeleton'
})
</script>

<template>
    <div :class="className">
        <div class="skeleton-content"></div>
    </div>
</template>

<style scoped>
.skeleton-content {
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    height: 100%;
    width: 100%;
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
</style>