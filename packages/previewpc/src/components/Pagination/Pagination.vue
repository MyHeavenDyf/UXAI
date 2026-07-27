<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from "vue"
import { ElPagination } from "element-plus"
import type { PaginationNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Pagination.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<PaginationNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const elPaginationRef = ref<InstanceType<typeof ElPagination>>()

onMounted(() => {
  const wrapper = (elPaginationRef.value as any)?.$el
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
const current = computed(() =>
  typeof properties.current === "number"
    ? properties.current
    : resolveValue(properties.current) as number
)
const currentPage = ref(current.value)
const total = computed(() =>
  typeof properties.total === "number"
    ? properties.total
    : resolveValue(properties.total) as number
)
const showTotal = computed(() => Boolean(resolveValue(properties.showTotal)))
const simple = computed(() => Boolean(resolveValue(properties.simple)))
const layout = computed(() => {
  if (simple.value) return showTotal.value ? "total, prev, next" : "prev, next"
  return showTotal.value ? "total, sizes, prev, pager, next, jumper" : "prev, pager, next"
})

watch(current, (value) => {
  currentPage.value = value
})

const handleCurrentChange = (value: number) => {
  currentPage.value = value
  if (properties.current && typeof properties.current === "object" && "path" in properties.current) {
    setValue(properties.current.path, value)
  }
}
</script>

<template>
  <ElPagination
    ref="elPaginationRef"
    :id="id"
    background
    :class="className"
    v-model:current-page="currentPage"
    :total="total"
    :layout="layout"
    :page-sizes="[10, 20, 50, 100]"
    @current-change="handleCurrentChange"
  />


</template>
