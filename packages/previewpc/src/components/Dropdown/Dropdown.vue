<script setup lang="ts">
import { computed, onMounted, ref, useAttrs, watch } from "vue"
import type { Component } from "vue"
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus"
import type { DropdownNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"

import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getIconComponentRef } from "../Icon/IconBase"

const triggerEnum = {
  click: "click",
  hover: "hover",
  contextMenu: "contextmenu",
}

const placementEnum = {
  bottom: "bottom",
  bottomLeft: "bottom-start",
  bottomRight: "bottom-end",
  top: "top",
  topLeft: "top-start",
  topRight: "top-end",
}

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
  return properties.trigger ? triggerEnum[properties.trigger as keyof typeof triggerEnum] as any : "hover"
})
const placement = computed(() => {
  return properties.placement ? placementEnum[properties.placement as keyof typeof placementEnum] as any : "bottom"
})

const children = computed(() => properties.children)
const items = computed(() => {
  const children = Array.isArray(properties.menu)
    ? properties.menu
    : (resolveValue(properties.menu) as []) || []

  if (!children.length) return []
  return children.map((item: any) => {
    const { label, icon, key } = item
    return {
      key,
      icon: resolveValue(icon) as string,
      label: resolveValue(label),
    }
  })
})

// ---- 异步图标解析 ----
const resolvedDropdownIcons = ref<Record<string | number, { component: Component | null; props: Record<string, any> } | null>>({})

watch(
  items,
  async (newItems) => {
    const map: Record<string | number, any> = {}
    await Promise.all(newItems.map(async (item: any) => {
      if (item.icon) {
        map[item.key] = await getIconComponentRef(item.icon, { size: 14 })
      }
    }))
    resolvedDropdownIcons.value = map
  },
  { immediate: true, deep: true },
)
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
      <ElDropdownMenu>
        <ElDropdownItem v-for="item in items" :key="item.key">
          <component
            v-if="item.icon && resolvedDropdownIcons[item.key]"
            class="mr-1"
            :is="resolvedDropdownIcons[item.key]?.component"
            v-bind="resolvedDropdownIcons[item.key]?.props ?? {}"
          />
          {{ item.label }}
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>
