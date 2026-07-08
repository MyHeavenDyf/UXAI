<script setup lang="ts">
import { computed } from "vue"
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus"
import type { DropdownNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"

import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getLucideIconComponentRef } from "../Icon/IconBase"

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
</script>

<template>
  <ElDropdown
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
            v-if="item.icon"
            class="mr-1"
            :is="getLucideIconComponentRef(item.icon)"
            :size="14"
          />
          {{ item.label }}
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>
