<script setup lang="ts">
import { computed, defineComponent, h, ref, watch } from "vue"
import type { Component } from "vue"
import { ElMenu, ElMenuItem, ElSubMenu } from "element-plus"
import type { MenuNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getIconComponentRef } from "../Icon/IconBase"
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

const mode = computed(() => (resolveValue(properties.mode) as string) || "vertical")
const inlineCollapsed = computed(() => (resolveValue(properties.inlineCollapsed) as boolean) || false)

// ---- 异步图标解析 ----
type ResolvedIcon = { component: Component | null; props: Record<string, any> } | null
const resolvedIcons = ref<Record<string | number, ResolvedIcon>>({})

watch(
  items,
  async (newItems) => {
    const map: Record<string | number, ResolvedIcon> = {}

    async function collect(items: MenuItemData[]) {
      const promises = items.map(async (item) => {
        if (item.icon) {
          map[item.key] = await getIconComponentRef(item.icon, { size: 16, strokeWidth: 2 })
        } else {
          map[item.key] = null
        }
        if (item.children) await collect(item.children)
      })
      await Promise.all(promises)
    }

    await collect(newItems)
    resolvedIcons.value = { ...map }
  },
  { immediate: true, deep: true },
)

const handleSelect = (_key: string) => {
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
      const resolved = resolvedIcons.value[item.key]
      const iconComponent = resolved?.component
        ? h(resolved.component, {
            ...resolved.props,
            class: inlineCollapsed.value ? '' : 'mr-3'
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
    :mode="mode as any"
    :ellipsis="false"
    :default-openeds="openKeys"
    :default-active="selectedKeys.length > 0 ? String(selectedKeys[0]) : ''"
    :collapse="inlineCollapsed as any"
    @select="handleSelect"
  >
    <MenuItemNode
      v-for="item in items"
      :key="item.key"
      :item="item"
    />
  </ElMenu>
</template>