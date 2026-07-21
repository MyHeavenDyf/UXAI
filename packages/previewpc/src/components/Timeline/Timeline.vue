<script setup lang="ts">
import { computed, ref, useAttrs, watch } from "vue"
import type { Component } from "vue"
import { ElTimeline, ElTimelineItem } from "element-plus"
import type { TimelineNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getIconComponentRef } from "../Icon/IconBase"
import "./Timeline.less"

const modeEnum = {
  start: "start",
  alternate: "alternate",
  end: "end",
}

const placementEnum = {
  start: "top",
  end: "bottom",
}

const props = defineProps<A2UIComponentProps<TimelineNode>>()
const { properties } = props.node
const { resolveValue } = useA2UIComponent(props.node, props.surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elTimelineRef = ref<InstanceType<typeof ElTimeline>>()

watch(
  () => (elTimelineRef.value as any)?.$el,
  (el) => {
    if (el instanceof HTMLElement) {
      if (attrs['id'] != null)
        el.setAttribute('id', String(attrs['id']))
      if (attrs['dom-picker-component'] != null)
        el.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
      if (attrs['data-element-props'] != null)
        el.setAttribute('data-element-props', String(attrs['data-element-props']))
    }
  },
  { flush: 'post', immediate: true },
)

const id = computed(() => props.node.id)
const className = computed(() => properties.className)

// const orientation = computed(() => properties.orientation)
const variant = computed(() => properties.variant)

const mode = computed(() => {
  return properties.mode ? modeEnum[properties.mode] : "start"
})

const rawItems = computed(() => {
  const children = props.node.properties.children
  if (!children.length) return []
  return children.map((item: any, index: number) => {
    const itemProps = item.properties

    const { icon, color, placement, className } = itemProps
    const iconName = resolveValue(icon) as string
    const content =
      itemProps.content?.path || typeof itemProps.content === "string"
        ? resolveValue(itemProps.content)
        : itemProps.content

    const title =
      itemProps.title?.path || typeof itemProps.title === "string"
        ? resolveValue(itemProps.title)
        : itemProps.title
    return {
      _index: index,
      title: title,
      iconName: iconName || undefined,
      color,
      placement: placement ? placementEnum[placement as keyof typeof placementEnum] as any : "top",
      className: className,
      content: content,
    }
  })
})

// ---- 异步图标解析 ----
type ResolvedItem = {
  title: any
  icon: Component | undefined
  color: string
  placement: "top" | "bottom"
  className: string
  content: any
}
const resolvedItems = ref<ResolvedItem[]>([])

watch(
  rawItems,
  async (raw) => {
    const results = await Promise.all(
      raw.map(async (r: any) => {
        if (!r.iconName) {
          return { title: r.title, icon: undefined, color: r.color, placement: r.placement, className: r.className, content: r.content }
        }
        const refComp = await getIconComponentRef(r.iconName, { size: 16 })
        return {
          title: r.title,
          icon: refComp?.component ?? undefined,
          color: r.color,
          placement: r.placement,
          className: r.className,
          content: r.content,
        }
      }),
    )
    resolvedItems.value = results
  },
  { immediate: true },
)
</script>

<template>
  <ElTimeline
    ref="elTimelineRef"
    :id="id"
    :class="className"
    :mode="mode as any"
    v-if="resolvedItems.length"
    direction="vertical"
  >
    <ElTimelineItem
      v-for="(item, index) in resolvedItems"
      :key="index"
      :hollow="variant ==='outlined'"
      :icon="item.icon"
      :color="item.color"
      :placement="item.placement"
      :class="item.className"
    >
      <template v-if ="item.placement === 'top'">
        <template v-if="typeof item.title === 'string'">
          {{ item.title }}
        </template>
        <ComponentNode v-else :node="item.title" :surface-id="surfaceId" />
      </template>
      <template v-if="typeof item.content === 'string'">
        {{ item.content }}
      </template>
      <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
      <template v-if ="item.placement === 'bottom'">
        <template v-if="typeof item.title === 'string'">
          {{ item.title }}
        </template>
        <ComponentNode v-else :node="item.title" :surface-id="surfaceId" />
      </template>

    </ElTimelineItem>



    
  </ElTimeline>
</template>
