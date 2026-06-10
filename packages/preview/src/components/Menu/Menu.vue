<script setup lang="ts">
import { computed, defineComponent, h } from "vue"
import { ElMenu, ElMenuItem, ElSubMenu } from "element-plus"
import type { MenuNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getLucideIconComponentRef } from "../Icon/IconBase"
import "./Menu.less"

interface MenuItemData {
  key: string | number
  title: string
  icon?: string
  children?: MenuItemData[]
}

const props = defineProps<A2UIComponentProps<MenuNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")

const items = computed<MenuItemData[]>(() => {
  const raw = properties.items
  if (Array.isArray(raw)) {
    return raw.map((item) => ({
      key: item.key,
      title: item.title,
      icon: item.icon,
      children: item.children,
    }))
  }
  const resolved = resolveValue(raw) as any
  return Array.isArray(resolved) ? resolved : []
})

const openKeys = computed<string[]>(() => {
  if (!properties.openKeys) return []
  const raw = properties.openKeys
  if (Array.isArray(raw)) return raw as string[]
  const resolved = resolveValue(raw) as any
  return Array.isArray(resolved) ? resolved : []
})

const selectedKeys = computed<string[]>(() => {
  if (!properties.selectedKeys) return []
  const raw = properties.selectedKeys
  if (Array.isArray(raw)) return raw as string[]
  const resolved = resolveValue(raw) as any
  return Array.isArray(resolved) ? resolved : []
})

const mode = computed(() => resolveValue(properties.mode) || "vertical")
const inlineCollapsed = computed(() => resolveValue(properties.inlineCollapsed) || false)

const handleSelect = (key: string) => {
  // Menu select event
}

// 递归菜单项组件
const MenuItemNode = defineComponent({
  name: "MenuItemNode",
  props: {
    item: {
      type: Object as () => MenuItemData,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const item = props.item
      const iconComponent = item.icon
        ? h(getLucideIconComponentRef(item.icon), {
            size: 16,
            strokeWidth: 1,
            class: inlineCollapsed.value ? '' : 'mr-1'
          })
        : null

      // 有 children 的情况使用 ElSubMenu
      if (item.children && item.children.length > 0) {
        return h(
          ElSubMenu,
          { index: String(item.key) },
          {
            title: () => [
              iconComponent,
              h("span", null, item.title),
            ],
            default: () =>
              item.children!.map((child) =>
                h(MenuItemNode, { item: child, key: child.key })
              ),
          }
        )
      }

      // 没有 children 的情况使用 ElMenuItem
      return h(
        ElMenuItem,
        { index: String(item.key) },
        {
          default: () => [iconComponent, h("span", null, item.title)],
        }
      )
    }
  },
})
</script>

<template>
  <ElMenu
    :id="id"
    :class="className"
    :mode="mode"
    :ellipsis="false"
    :default-openeds="openKeys"
    :default-active="selectedKeys.length > 0 ? String(selectedKeys[0]) : ''"
    :collapse="inlineCollapsed"
    @select="handleSelect"
  >
    <MenuItemNode
      v-for="item in items"
      :key="item.key"
      :item="item"
    />
  </ElMenu>
</template>