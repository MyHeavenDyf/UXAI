<script setup lang="ts">
import { computed } from "vue"
import { ElCarousel, ElCarouselItem } from "element-plus"
import type { CarouselNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import "./Carousel.less"

const dotPlacementMap: Record<string, string> = {
  top: "carousel-top",
  bottom: "carousel-bottom",
  start: "carousel-left",
  end: "carousel-right",
}

const props = defineProps<A2UIComponentProps<CarouselNode>>()
const { node, surfaceId } = props
const { properties } = node
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")

const arrows = computed(() => properties.arrows ?? true)
const arrowType = computed(() => (arrows.value ? "hover" : "never"))

const height = computed(() => {
  if (properties.adaptiveHeight) return undefined
  return "300px"
})

const dotPlacement = computed(() => {
  const placement = properties.dotPlacement
  if (!placement) return ""
  return dotPlacementMap[placement] || ""
})

const carouselItems = computed(() => {
  const children = properties.children || []
  return children.map((item: any, index: number) => ({
    index,
    node: item,
  }))
})
</script>

<template>
  <ElCarousel
    :id="id"
    :class="[className, dotPlacement]"
    :arrow="arrowType"
    :height="height"
    :loop="true"
    :autoplay="false"
  >
    <ElCarouselItem
      v-for="item in carouselItems"
      :key="item.index"
    >
      <ComponentNode :node="item.node" :surface-id="surfaceId" />
    </ElCarouselItem>
  </ElCarousel>
</template>
