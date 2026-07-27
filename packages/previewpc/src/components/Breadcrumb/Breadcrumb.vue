<script setup lang="ts">
import { computed, onMounted, ref, useAttrs } from "vue"
import { ElBreadcrumb, ElBreadcrumbItem } from "element-plus"
import type { BreadcrumbNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import "./Breadcrumb.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<BreadcrumbNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const elBreadcrumbRef = ref<InstanceType<typeof ElBreadcrumb>>()

onMounted(() => {
  const wrapper = (elBreadcrumbRef.value as any)?.$el
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
  <ElBreadcrumb ref="elBreadcrumbRef" :id="id" :class="className" :separator="separator">
    <ElBreadcrumbItem v-for="(item, index) in items" :key="index">
      <template v-if="typeof item.content === 'string'">
        {{ item.content }}
      </template>
      <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
    </ElBreadcrumbItem>
  </ElBreadcrumb>
</template>
