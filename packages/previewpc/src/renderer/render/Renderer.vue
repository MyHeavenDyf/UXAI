<script setup lang="ts">
import { useSurface } from './hooks'
import ComponentNode from './ComponentNode.vue'
import { ComponentRegistry } from '../registry/ComponentRegistry'
import { ref, watch } from 'vue'


const props = defineProps<{
    surfaceId: string
    registry?: ComponentRegistry
}>()

const surface = useSurface(props.surfaceId)
const renderKey = ref(0)

watch(() => surface.value?.componentTree, () => {
    renderKey.value++
})


</script>

<template>
    <div v-if="surface?.componentTree" class="a2ui-surface flex flex-col flex-1 h-full" :key="renderKey">
        <ComponentNode :node="surface.componentTree" :surfaceId="props.surfaceId" :registry="props.registry" />
    </div>
</template>