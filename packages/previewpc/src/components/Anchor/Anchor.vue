<script setup lang="ts">
import { computed, useAttrs } from "vue"
import { ElAnchor, ElAnchorLink } from "element-plus"
import type { AnchorNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent, useSurface } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import "./Anchor.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const props = defineProps<A2UIComponentProps<AnchorNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)
const offsetTop = computed(() => (properties?.offsetTop as number) ?? 0)

// 滚动容器：JSON 显式给值则用该选择器（透传给 EP 的 container，querySelector 命中）；
// 省略时默认用 surface 根节点（rootId）元素；无 rootId 时回退 window（EP 默认）。
const surface = useSurface(surfaceId)
const rootId = computed(() => surface.value?.componentTree?.id as string | undefined)
const container = computed(() => {
  const c = properties?.container
  if (c) return String(c)
  const rid = rootId.value
  return rid ? `#${rid}` : null
})

function resolveItem(item: any) {
  const title =
    item.title?.path || typeof item.title === "string"
      ? resolveValue(item.title)
      : item.title
  return {
    key: item.key,
    href: item.href,
    content: title,
    children: Array.isArray(item.children)
      ? item.children.map(resolveItem)
      : undefined,
  }
}

const items = computed(() => {
  let data: any[] = []
  if (Array.isArray(properties.items)) {
    data = properties.items
  } else {
    data = (resolveValue(properties.items) as any[]) ?? []
  }

  return data.map(resolveItem)
})

// hash 路由（createWebHashHistory）下，<a href="#id"> 点击会让浏览器把
// location.hash 改成 "#id"，被 vue-router 当作路由跳转而导致页面 404。
// EP 的 el-anchor-link 自身 click handler 不调用 preventDefault，但其滚动
// 逻辑（scrollTo → querySelector(href)）与浏览器默认行为相互独立。
// 故在此捕获阶段拦截：阻止默认 hash 跳变，EP 的冒泡 handler 仍会完成滚动。
function onLinkClickCapture(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest?.("a.el-anchor__link")) {
    e.preventDefault()
  }
}
</script>
<template>
  <div
    :id="(attrs.id as string) ?? id"
    :class="className"
    :dom-picker-component="(attrs['dom-picker-component'] as string)"
    :data-element-props="(attrs['data-element-props'] as string)"
    @click.capture="onLinkClickCapture"
  >
    <ElAnchor :offset="offsetTop" :container="container">
      <ElAnchorLink
        v-for="item in items"
        :key="item.key"
        :href="item.href"
        :title="typeof item.content === 'string' ? item.content : undefined"
      >
        <template v-if="typeof item.content !== 'string'">
          <ComponentNode :node="item.content" :surface-id="surfaceId" />
        </template>
        <template v-if="item.children?.length" #sub-link>
          <ElAnchorLink
            v-for="child in item.children"
            :key="child.key"
            :href="child.href"
            :title="typeof child.content === 'string' ? child.content : undefined"
          >
            <template v-if="typeof child.content !== 'string'">
              <ComponentNode :node="child.content" :surface-id="surfaceId" />
            </template>
          </ElAnchorLink>
        </template>
      </ElAnchorLink>
    </ElAnchor>
  </div>
</template>
