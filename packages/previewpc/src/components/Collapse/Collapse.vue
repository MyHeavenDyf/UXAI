<script setup lang="ts">
import { computed, ref } from "vue"
import {
  ElCollapse,
  ElCollapseItem,
  type CollapseIconPositionType,
} from "element-plus"
import type { CollapseNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import {  getLucideIconComponentRef } from "../Icon/IconBase"
import "./Collapse.less"
// const sizeEnum = {
//   large: "large",
//   medium: "default",
//   small: "small",
// }
const placementEnum = {
  start: "left",
  end: "right",
}

const props = defineProps<A2UIComponentProps<CollapseNode>>()
const { resolveValue } = useA2UIComponent(props.node, props.surfaceId)

const { properties } = props.node

const id = computed(() => props.node.id)
const className = computed(() => properties.className)

const accordion = computed(() => properties.accordion)
const expandIcon = computed(() => properties.expandIcon)
const expandIconPlacement = computed(() => {
  const placement = properties.expandIconPlacement
  return (
    placement ? placementEnum[placement] : "right"
  ) as CollapseIconPositionType
})

const activeKey = ref(resolveValue(properties.activeKey) as string | string[])

// const size = computed(() => {
//   return properties.size ? sizeEnum[properties.size] : "default"
// })

const items = computed(() => {
  const data = properties.children

  return data.map((item: any) => {
    const itemProps = item.properties
   
    const key = resolveValue(itemProps.key) as string
    const label = resolveValue(itemProps.label) as string
    // const extra = resolveValue(item.extra) as string
    const content =
      itemProps.content?.path || typeof itemProps.content === "string"
        ? resolveValue(itemProps.content)
        : itemProps.content
    return {
      key: key,
      title: label,
      content: content,
    }
  })
})
</script>

<template>
  <ElCollapse
    :id="id"
    :class="className"
    :expand-icon-position="expandIconPlacement"
    :accordion="accordion"
    v-model="activeKey"
  >
    <ElCollapseItem
      v-for="item in items"
      :key="item.key"
      :name="item.key"
      :title="item.title"
    >
      <template v-if="expandIcon" #icon>
        <component :is="getLucideIconComponentRef(expandIcon)" :size="16"  />
      </template>
      <template v-if="typeof item.content === 'string'">
        {{ item.content }}
      </template>
      <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
    </ElCollapseItem>
  </ElCollapse>
</template>
