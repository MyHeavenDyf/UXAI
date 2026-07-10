<script setup lang="ts">
import { computed, h } from "vue"
import { ElTimeline, ElTimelineItem } from "element-plus"
import type { TimelineNode } from "../types"
import { useA2UIComponent, type A2UIComponentProps } from "../../renderer"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getLucideIconComponentRef } from "../Icon/IconBase"
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

const id = computed(() => props.node.id)
const className = computed(() => properties.className)

// const orientation = computed(() => properties.orientation)
const variant = computed(() => properties.variant)

const mode = computed(() => {
  return properties.mode ? modeEnum[properties.mode] : "start"
})

const items = computed(() => {
  const children = props.node.properties.children
  if (!children.length) return []
  return children.map((item: any) => {
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
      title: title,
      icon: iconName ? h(getLucideIconComponentRef(iconName), { size: 16 }) : undefined,
      color,
      placement: placement ? placementEnum[placement as keyof typeof placementEnum] as any : "top",
      className: className,
      content: content,
    }
  })
})
</script>

<template>
  <ElTimeline
    :id="id"
    :class="className"
    :mode="mode as any"
    v-if="items.length"
    direction="vertical"
  >
    <ElTimelineItem
      v-for="(item, index) in items"
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
