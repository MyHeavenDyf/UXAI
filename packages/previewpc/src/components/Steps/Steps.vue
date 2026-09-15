<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useAttrs, watch } from "vue"
import type { Component } from "vue"
import { ElSteps, ElStep, type StepsStatus } from "element-plus"
import type { StepsNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"
import { useA2UI } from "../../renderer/render/Provider"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getIconComponentRef } from "../Icon/IconBase"
import { svgCacheVersion } from "../../composables/useIconProvider"
import { useTheme } from "../../composables/useTheme"
import "./Steps.less"
const statusEnum = {
  wait: "wait",
  process: "process",
  finish: "finish",
  error: "error",
}
// 把绑定值统一转成 ElSteps active 需要的 number（state 里是字符串 "0"）
const toStep = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const props = defineProps<A2UIComponentProps<StepsNode>>()
const { properties } = props.node

const { resolveValue, getValue } = useA2UIComponent(props.node, props.surfaceId)
const { store } = useA2UI()

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elStepsRef = ref<InstanceType<typeof ElSteps>>()

onMounted(() => {
  const wrapper = (elStepsRef.value as any)?.$el
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

const orientation = computed(() => properties.orientation)
const status = computed(() => {
  const temp = resolveValue(properties.status as any) as string
  return (temp ? statusEnum[temp as keyof typeof statusEnum] : "process") as StepsStatus
})
const simple = computed(() => {
  return properties.types === "panel"
})
const current = computed(() => toStep(resolveValue(properties.current)))

// current 绑定路径：若 state 已预声明该 key，构建期会把 { path } 折叠成字面量、路径丢失；
// 此时从 store 的原始 elements（未折叠）里取回 current 的绑定路径，确保外部按钮 setState/cycleState 能驱动当前步。
const bindingPath = computed<string | null>(() => {
  const c = properties.current as any
  if (c && typeof c === "object" && !Array.isArray(c) && typeof c.path === "string") {
    return c.path
  }
  const rawCurrent = (store.getSurface(props.surfaceId) as any)?.components?.get?.(props.node.id)?.props?.current
  if (rawCurrent && typeof rawCurrent === "object" && !Array.isArray(rawCurrent) && typeof rawCurrent.path === "string") {
    return rawCurrent.path
  }
  return null
})

// 响应式当前步：订阅 store，notify 时（setState/cycleState 触发）重读绑定路径的值。
const activeStep = ref(current.value)
const readActiveStep = () => {
  activeStep.value = toStep(bindingPath.value ? getValue(bindingPath.value) : resolveValue(properties.current))
}
readActiveStep()
let unsubscribe: (() => void) | null = null
onMounted(() => {
  if (bindingPath.value) {
    unsubscribe = store.subscribeToSurface(props.surfaceId, readActiveStep)
  }
})
onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})

const items = computed(() => {
  const children = props.node.properties.children
  if (!children.length) return []

  return children.map((item: any) => {
    const itemProps = item.properties
    const title =
      itemProps.title?.path || typeof itemProps.title === "string"
        ? resolveValue(itemProps.title)
        : itemProps.title
    const content =
      itemProps.content?.path || typeof itemProps.content === "string"
        ? resolveValue(itemProps.content)
        : itemProps.content
    return {
      title: title,
      description: content,
      icon: resolveValue(itemProps.icon) as string,
      status: resolveValue(itemProps.status),
      className: itemProps.className,
    }
  })
})

// ---- 图标解析（同步，追踪 svgCacheVersion 以响应 SVG 到达） ----
const { isDark } = useTheme()
const resolvedStepIcons = ref<Record<number, { component: Component | null; props: Record<string, any> } | null>>({})

watch(
  [items, svgCacheVersion, isDark],
  ([newItems]) => {
    const map: Record<number, any> = {}

    for (let index = 0; index < newItems.length; index++) {
      const item = newItems[index] as any
      if (item.icon) {
        map[index] = getIconComponentRef(item.icon, { size: 24, shape: 'lined' })
      }
    }
    resolvedStepIcons.value = map
  },
  { immediate: true, deep: true },
)
</script>

<template>
  <ElSteps
    ref="elStepsRef"
    :id="id"
    :class="className"
    v-if="items.length"
    :direction="orientation"
    :process-status="status"
    :simple="simple"
    :active="activeStep"
    align-center
  >
    <ElStep
      v-for="(item, index) in items"
      :key="index"
      :status="item.status as any"
      :class="item.className"
    >
      <template #icon v-if="item.icon && resolvedStepIcons[index]">
        <component :is="resolvedStepIcons[index]?.component" v-bind="resolvedStepIcons[index]?.props ?? {}" />
      </template>
      <template #title>
        <template v-if="typeof item.title === 'string'">{{
          item.title
        }}</template>
        <ComponentNode v-else :node="item.title" :surface-id="surfaceId" />
      </template>
      <template #description v-if="item.description">
        <template v-if="typeof item.description === 'string'">{{
          item.description
        }}</template>
        <ComponentNode
          v-else
          :node="item.description"
          :surface-id="surfaceId"
        />
      </template>
    </ElStep>
  </ElSteps>
</template>
