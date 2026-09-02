<script setup lang="ts">
import { computed, onMounted, ref, useAttrs } from "vue"
import { ElPopover } from "element-plus"
import type { PopoverNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps, type DataBinding } from "../../renderer"

import ComponentNode from "../../renderer/render/ComponentNode.vue"

// schema 的 trigger 为数组，ElPopover 的 trigger 只接受单个值
const triggerEnum: Record<string, "hover" | "click" | "focus"> = {
  click: "click",
  hover: "hover",
  contextMenu: "click", // ElPopover 不支持 contextMenu，降级为 click
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

const props = defineProps<A2UIComponentProps<PopoverNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elPopoverRef = ref<InstanceType<typeof ElPopover>>()

onMounted(() => {
  const wrapper = (elPopoverRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

const id = computed(() => node.id)
const className = computed(() => properties.className)

const trigger = computed(() => {
  const arr = properties.trigger
  if (Array.isArray(arr) && arr.length) {
    return triggerEnum[arr[0]] ?? "hover"
  }
  return "hover"
})
const placement = computed(() => {
  return properties.placement ? placementEnum[properties.placement] ?? "top" : "top"
})

const title = computed(() => resolveValue(properties.title) as string || "")

// content 可能是字符串（原始文本 / DataBinding 解析结果）或 AnyComponentNode（SlotNode 解析结果）
const content = computed(() => {
  const raw = properties.content
  if (typeof raw === "string") return raw
  // 仅 DataBinding { path } 需要走 resolveValue；已解析的 SlotNode 节点直接返回
  if (raw && typeof raw === "object" && "path" in raw) {
    return resolveValue(raw as DataBinding)
  }
  return raw
})
const contentIsNode = computed(() => {
  const val = content.value
  return val !== null && typeof val === "object" && typeof (val as any).type === "string"
})

const children = computed(() => properties.children)
</script>

<template>
  <ElPopover
    ref="elPopoverRef"
    :id="id"
    :class="className"
    :placement="placement"
    :trigger="trigger"
    :title="title || undefined"
  >
    <template v-if="contentIsNode">
      <ComponentNode
        :node="content as any"
        :surface-id="surfaceId"
      />
    </template>
    <template v-else>
      {{ content }}
    </template>

    <template #reference>
      <span class="a2ui-popover__reference">
        <ComponentNode
          v-for="node in children"
          :key="node.id"
          :node="node"
          :surface-id="surfaceId"
        />
      </span>
    </template>
  </ElPopover>
</template>

<style lang="less">
.a2ui-popover__reference {
  display: inline-block;
}
</style>
