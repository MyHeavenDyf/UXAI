<script setup lang="ts">
import { useSurface } from './hooks'
import ComponentNode from './ComponentNode.vue'
import { ComponentRegistry } from '../registry/ComponentRegistry'


const props = defineProps<{
    surfaceId: string
    registry?: ComponentRegistry
}>()

const surface = useSurface(props.surfaceId)


</script>

<template>
    <div v-if="surface?.componentTree" class="a2ui-surface flex flex-col flex-1 h-full">
        <ComponentNode :node="surface.componentTree" :surfaceId="props.surfaceId" :registry="props.registry" />
    </div>
</template>