<script setup lang="ts">
import { computed } from "vue"
import { ElBreadcrumb, ElBreadcrumbItem } from "element-plus"
import type { BreadcrumbNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import "./Breadcrumb.less"

const props = defineProps<A2UIComponentProps<BreadcrumbNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const separator = computed(() => (properties?.separator as string) || "/")

const items = computed(() => {
  let data = []
  if (Array.isArray(properties.items)) {
    data = properties.items
  } else {
    data = resolveValue(properties.items) as []
  }

  return data.map((item: any) => {
    // const type = resolveValue(item.type) as string
    // const separator = resolveValue(item.separator) as string
    const title =
      item.title?.path || typeof item.title === "string"
        ? resolveValue(item.title)
        : item.title
    return {
      content: title,
    }
  })
})
</script>
<template>
  <ElBreadcrumb :id="id" :class="className" :separator="separator">
    <ElBreadcrumbItem v-for="(item, index) in items" :key="index">
      <template v-if="typeof item.content === 'string'">
        {{ item.content }}
      </template>
      <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
    </ElBreadcrumbItem>
  </ElBreadcrumb>
</template>
