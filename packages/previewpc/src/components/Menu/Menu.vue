<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, useAttrs, watch } from "vue"
import type { Component } from "vue"
import { ElMenu, ElMenuItem, ElSubMenu } from "element-plus"
import type { MenuNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getIconComponentRef } from "../Icon/IconBase"
import { svgCacheVersion } from "../../composables/useIconProvider"
import { useTheme } from "../../composables/useTheme"
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
const { resolveValue, commitActivation } = useA2UIComponent(node, surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elMenuRef = ref<InstanceType<typeof ElMenu>>()

onMounted(() => {
  const wrapper = (elMenuRef.value as any)?.$el
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

const { isDark } = useTheme()

// ---- 图标解析（同步，追踪 svgCacheVersion 以响应 SVG 到达） ----
type ResolvedIcon = { component: Component | null; props: Record<string, any> } | null
const resolvedIcons = ref<Record<string | number, ResolvedIcon>>({})

watch(
  [items, svgCacheVersion, isDark],
  ([newItems]) => {
    const map: Record<string | number, ResolvedIcon> = {}
    const shape = isDark.value ? 'fill' : 'lined'

    function collect(items: MenuItemData[]) {
      for (const item of items) {
        if (item.icon) {
          map[item.key] = getIconComponentRef(item.icon, { size: 16, strokeWidth: 2, shape })
        } else {
          map[item.key] = null
        }
        if (item.children) collect(item.children)
      }
    }

    collect(newItems)
    resolvedIcons.value = { ...map }
  },
  { immediate: true, deep: true },
)

const currentOpenKeys = ref<string[]>([...openKeys.value])

const handleSelect = (key: string) => {
  commitActivation('selectedKeys', [key])
}

const handleOpen = (index: string) => {
  if (!currentOpenKeys.value.includes(index)) {
    currentOpenKeys.value = [...currentOpenKeys.value, index]
    commitActivation('openKeys', currentOpenKeys.value)
  }
}

const handleClose = (index: string) => {
  if (currentOpenKeys.value.includes(index)) {
    currentOpenKeys.value = currentOpenKeys.value.filter(k => k !== index)
    commitActivation('openKeys', currentOpenKeys.value)
  }
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
    ref="elMenuRef"
    :id="id"
    :class="className"
    :mode="mode as any"
    :ellipsis="false"
    :default-openeds="openKeys"
    :default-active="selectedKeys.length > 0 ? String(selectedKeys[0]) : ''"
    :collapse="inlineCollapsed as any"
    @select="handleSelect"
    @open="handleOpen"
    @close="handleClose"
  >
    <MenuItemNode
      v-for="item in items"
      :key="item.key"
      :item="item"
    />
  </ElMenu>
</template>