<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { Component } from "vue"
import { ElSteps, ElStep, type StepsStatus } from "element-plus"
import type { StepsNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getIconComponentRef } from "../Icon/IconBase"
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

// ---- 异步图标解析 ----
const resolvedStepIcons = ref<Record<number, { component: Component | null; props: Record<string, any> } | null>>({})

watch(
  items,
  async (newItems) => {
    const map: Record<number, any> = {}
    await Promise.all(newItems.map(async (item: any, index: number) => {
      if (item.icon) {
        map[index] = await getIconComponentRef(item.icon, { size: 16 })
      }
    }))
    resolvedStepIcons.value = map
  },
  { immediate: true, deep: true },
)
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
      <template #icon v-if="item.icon && resolvedStepIcons[index]">
        <component :is="resolvedStepIcons[index]?.component" v-bind="resolvedStepIcons[index]?.props ?? {}" />
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
