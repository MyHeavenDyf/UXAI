<script setup lang="ts">
import { computed } from "vue"
import { ElBadge } from "element-plus"
import type { BadgeNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import './Badge.less'

const statusEnum = {
  success: "success",
  processing: "primary",
  default:"info",
  error: "danger",
  warning: "warning",
}

const props = defineProps<A2UIComponentProps<BadgeNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const color = computed(() => resolveValue(properties?.color) as string || "")
const count = computed(() => (resolveValue(properties.count))?.toString() ?? "0")

const dot = computed(() => properties?.dot || count.value === "")
const offset = computed(() => (properties?.offset || [0, 0]) as [number, number])
const overflowCount = computed(() => properties?.overflowCount || 99)
const showZero = computed(() => properties?.showZero || true)
const status = computed(() => {
  const resStatus = resolveValue(properties.status as any) as string
  return (resStatus ? statusEnum[resStatus as keyof typeof statusEnum] : "danger") as any
})

const children = computed(() => properties.children ?? [])
</script>
<template>
  <ElBadge
    :id="id"
    :class="className"
    :type="status"
    :color="color"
    :value="count"
    :is-dot="dot"
    :offset="offset"
    :max="overflowCount"
    :show-zero="showZero"
  >
    <ComponentNode
      v-for="(item, index) in children"
      :key="index"
      :node="item"
      :surface-id="surfaceId"
    />
  </ElBadge>
</template>
