<script setup lang="ts">
import { computed } from "vue"
import { ElSteps, ElStep, type StepsStatus } from "element-plus"
import type { StepsNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getLucideIconComponentRef } from "../Icon/IconBase"
import "./Steps.less"
const statusEnum = {
  wait: "wait",
  process: "process",
  finish: "finish",
  error: "error",
}
const props = defineProps<A2UIComponentProps<StepsNode>>()
const { properties } = props.node

const { resolveValue } = useA2UIComponent(props.node, props.surfaceId)

const id = computed(() => props.node.id)
const className = computed(() => properties.className)

const orientation = computed(() => properties.orientation)
const status = computed(() => {
  const temp = resolveValue(properties.status as any) as string
  return (temp ? statusEnum[temp as keyof typeof statusEnum] : "process") as StepsStatus
})
const simple = computed(() => {
  return properties.types === "panel"
})
const current = computed(() => resolveValue(properties.current) as number)

const items = computed(() => {
  const children = props.node.properties.children
  if (!children.length) return []

  return children.map((item: any) => {
    const itemProps = item.properties
    const title =
      itemProps.title?.path || typeof itemProps.title === "string"
        ? resolveValue(itemProps.title)
        : itemProps.title
    const content =
      itemProps.content?.path || typeof itemProps.content === "string"
        ? resolveValue(itemProps.content)
        : itemProps.content
    return {
      title: title,
      description: content,
      icon: resolveValue(itemProps.icon) as string,
      status: resolveValue(itemProps.status),
      className: itemProps.className,
    }
  })
})
</script>

<template>
  <ElSteps
    :id="id"
    :class="className"
    v-if="items.length"
    :direction="orientation"
    :process-status="status"
    :simple="simple"
    :active="current"
    align-center
  >
    <ElStep
      v-for="(item, index) in items"
      :key="index"
      :status="item.status as any"
      :class="item.className"
    >
      <template #icon v-if="item.icon">
        <component :is="getLucideIconComponentRef(item.icon)" :size="16" />
      </template>
      <template #title>
        <template v-if="typeof item.title === 'string'">{{
          item.title
        }}</template>
        <ComponentNode v-else :node="item.title" :surface-id="surfaceId" />
      </template>
      <template #description v-if="item.description">
        <template v-if="typeof item.description === 'string'">{{
          item.description
        }}</template>
        <ComponentNode
          v-else
          :node="item.description"
          :surface-id="surfaceId"
        />
      </template>
    </ElStep>
  </ElSteps>
</template>
