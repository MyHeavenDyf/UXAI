<script setup lang="ts">
import { computed, onMounted, ref, useAttrs } from "vue"
import {
  ElCollapse,
  ElCollapseItem,
  type CollapseIconPositionType,
} from "element-plus"
import type { CollapseNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { useIconComponentRef } from "../Icon/IconBase"
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

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elCollapseRef = ref<InstanceType<typeof ElCollapse>>()

onMounted(() => {
  const wrapper = (elCollapseRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

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

// ---- 异步图标解析 ----
const resolvedIcon = useIconComponentRef(expandIcon, { size: 16 })

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
    ref="elCollapseRef"
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
      <template v-if="expandIcon && resolvedIcon?.component" #icon>
        <component :is="resolvedIcon.component" v-bind="resolvedIcon.props" />
      </template>
      <template v-if="typeof item.content === 'string'">
        {{ item.content }}
      </template>
      <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
    </ElCollapseItem>
  </ElCollapse>
</template>
