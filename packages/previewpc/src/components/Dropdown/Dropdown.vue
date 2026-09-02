<script setup lang="ts">
import { computed, onMounted, ref, useAttrs } from "vue"
import { ElDropdown } from "element-plus"
import type { DropdownItem, DropdownNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"

import ComponentNode from "../../renderer/render/ComponentNode.vue"
import DropdownMenuList from "./DropdownMenuList.vue"

// schema 的 trigger 为数组，ElDropdown 的 trigger 只接受单个值
const triggerEnum: Record<string, "hover" | "click" | "contextmenu"> = {
  click: "click",
  hover: "hover",
  contextMenu: "contextmenu",
}

const placementEnum = {
  top: "top",
  topLeft: "top-start",
  topRight: "top-end",
  bottom: "bottom",
  bottomLeft: "bottom-start",
  bottomRight: "bottom-end",
  left: "left",
  leftTop: "left-start",
  leftBottom: "left-end",
  right: "right",
  rightTop: "right-start",
  rightBottom: "right-end",
} as const

const props = defineProps<A2UIComponentProps<DropdownNode>>()
const { properties } = props.node
const { resolveValue } = useA2UIComponent(props.node, props.surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elDropdownRef = ref<InstanceType<typeof ElDropdown>>()

onMounted(() => {
  const wrapper = (elDropdownRef.value as any)?.$el
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

const trigger = computed(() => {
  const arr = properties.trigger
  if (Array.isArray(arr) && arr.length) {
    return triggerEnum[arr[0]] ?? "hover"
  }
  return "hover"
})
const placement = computed(() => {
  return properties.placement ? placementEnum[properties.placement] ?? "bottom" : "bottom"
})

const children = computed(() => properties.children)
const items = computed<DropdownItem[]>(() => {
  const raw = properties.menu
  const resolved = Array.isArray(raw) ? raw : resolveValue(raw)
  if (!Array.isArray(resolved) || !resolved.length) return []
  return resolved.map((item: any) => {
    const { label, icon, key, children } = item
    return {
      key,
      icon: resolveValue(icon) as string,
      label: resolveValue(label),
      children: Array.isArray(children) && children.length ? children : undefined,
    } as DropdownItem
  })
})
</script>

<template>
  <ElDropdown
    ref="elDropdownRef"
    :id="id"
    :class="className"
    :placement="placement"
    :trigger="trigger"
  >
    <div>
      <ComponentNode
        v-for="node in children"
        :node="node"
        :surface-id="surfaceId"
      />
    </div>

    <template #dropdown>
      <DropdownMenuList :items="items" :surface-id="surfaceId" />
    </template>
  </ElDropdown>
</template>
