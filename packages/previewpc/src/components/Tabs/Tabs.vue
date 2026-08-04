<script setup lang="ts">
import { computed, onMounted, ref, useAttrs, watch } from "vue"
import type { Component } from "vue"
import { ElTabs, ElTabPane, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus"
import type { TabsNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getIconComponentRef } from "../Icon/IconBase"
import { svgCacheVersion } from "../../composables/useIconProvider"
import { useTheme } from "../../composables/useTheme"
import "./Tabs.less"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}
const typeEnum = {
  line: "",
  card: "card",
  "separator": "separator",
}

const positionEnum = {
  top: "top",
  end: "right",
  bottom: "bottom",
  start: "left",
}

const props = defineProps<A2UIComponentProps<TabsNode>>()
const { properties } = props.node

const { resolveValue, commitActivation } = useA2UIComponent(props.node, props.surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elTabsRef = ref<InstanceType<typeof ElTabs>>()

onMounted(() => {
  const wrapper = (elTabsRef.value as any)?.$el
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

const types = computed(() => properties.types)
const type = computed(() => {
  return types.value ? typeEnum[types.value] : ""
})
const size = computed(() => {
  return properties.size ? sizeEnum[properties.size] : "default"
})
const className = computed(() => {
  const classes = properties.className ?? ''
  const typeClass = type.value ? ` tabs-${type.value}` : ''
  const sizeClass = size.value ? ` is-${size.value}` : ''
  return classes + typeClass + sizeClass
})

const editable = computed(() =>
  items.value.some((item: any) => item.closable)
)

const iconSize = computed(() => {
  switch (type.value) {
    case 'card': return 14;
    case 'line': return size.value === 'large' ? 18 : 16;
    case 'separator': return size.value === 'small' ? 16 : 20;
    default: return size.value === 'large' ? 18 : 16;
  }
})


const position = computed(() => {
  return properties.tabPlacement ? positionEnum[properties.tabPlacement] : "top"
})

const activeKey = ref(resolveValue(properties.activeKey) as string)

watch(activeKey, (val) => {
  if (val != null) commitActivation('activeKey', val)
})


const removedKeys = ref<Set<string>>(new Set())

const items = computed(() => {
  const tabs = properties.children || []
  return tabs
    .filter((item: any, index: number) => {
      const key = (resolveValue(item.properties.key) as string) || String(index)
      return !removedKeys.value.has(key)
    })
    .map((item: any, index: number) => {
    const itemProps = item.properties

    const label = resolveValue(itemProps.label) as string
    const key = (resolveValue(itemProps.key) as string) || String(index)
    const icon = resolveValue(itemProps.icon) as string
    const disabled = resolveValue(itemProps.disabled) as boolean
    const closable = (resolveValue(itemProps.closable) as boolean) || false

    const content =
      itemProps.content?.path || typeof itemProps.content === "string"
        ? resolveValue(itemProps.content)
        : itemProps.content
    return {
      name: key,
      label: label,
      icon: icon,
      disabled: disabled,
      closable: closable,
      content: content,
    }
  })
})

const handleTabRemove = (name: string | number) => {
  removedKeys.value.add(String(name))
  removedKeys.value = new Set(removedKeys.value)
  if (activeKey.value === String(name) && items.value.length > 0) {
    activeKey.value = items.value[0].name
  }
}

// ---- 图标解析（同步，追踪 svgCacheVersion 以响应 SVG 到达） ----
const { isDark } = useTheme()

// ---- overflow（maxVisible）逻辑 ----
const maxVisible = computed(() => properties.maxVisible as number | undefined)
const hasOverflow = computed(() => !!maxVisible.value && items.value.length > maxVisible.value)
const overflowItems = computed(() => {
  if (!hasOverflow.value || !maxVisible.value) return []
  return items.value.slice(maxVisible.value - 1)
})

const overflowVisible = ref(false)
const overflowTriggerRef = ref<HTMLElement>()

const visibleItems = computed(() => {
  if (!hasOverflow.value || !maxVisible.value) return items.value
  return items.value.slice(0, maxVisible.value - 1)
})

const handleOverflowSelect = (name: string) => {
  activeKey.value = name
  overflowVisible.value = false
}

const overflowDropdownRef = ref<InstanceType<typeof ElDropdown>>()
const positionOverflowTrigger = () => {
  requestAnimationFrame(() => {
    const tabsEl = (elTabsRef.value as any)?.$el as HTMLElement
    const header = tabsEl?.querySelector('.el-tabs__header') as HTMLElement
    const dropdownEl = (overflowDropdownRef.value as any)?.$el as HTMLElement
    if (!header || !dropdownEl || !maxVisible.value) return

    const navItems = header.querySelectorAll('.el-tabs__item')
    const limit = Math.min(maxVisible.value - 1, navItems.length)
    const lastItem = navItems[limit - 1] as HTMLElement
    if (lastItem) {
      const headerRect = header.getBoundingClientRect()
      const lastRect = lastItem.getBoundingClientRect()
      const isSeparator = type.value === 'separator'
      const isCard = type.value === 'card'
      const triggerEl = overflowTriggerRef.value
      const padLeft = (!isSeparator && !isCard && triggerEl) ? parseFloat(getComputedStyle(triggerEl).paddingLeft) : 0
      const offsetX = lastRect.right - headerRect.left + padLeft
      dropdownEl.style.left = `${offsetX}px`
    }
  })
}

onMounted(() => {
  positionOverflowTrigger()
})

watch(
  [items, maxVisible, hasOverflow, activeKey],
  () => { positionOverflowTrigger() },
  { flush: 'post' },
)

const overflowIconSize = computed(() => {
  if (type.value === 'separator') return size.value === 'small' ? 16 : 20
  return size.value === 'small' ? 14 : (size.value === 'large' ? 18 : 16)
})
const overflowIconRef = ref<{ component: Component | null; props: Record<string, any> } | null>(null)
watch(
  [hasOverflow, overflowIconSize, svgCacheVersion, isDark],
  ([enabled, sz]) => {
    if (!enabled) {
      overflowIconRef.value = null
      return
    }
    const shape = isDark.value ? 'fill' : 'lined'
    overflowIconRef.value = getIconComponentRef('chevron-down', { size: sz as number, strokeWidth: 1.5, shape })
  },
  { immediate: true },
)

const resolvedTabIcons = ref<Record<string, { component: Component | null; props: Record<string, any> } | null>>({})

watch(
  [items, iconSize, svgCacheVersion, isDark],
  ([newItems, sz]) => {
    const map: Record<string, any> = {}

    for (const item of (newItems as any[])) {
      if (item.icon) {
        map[item.name] = getIconComponentRef(item.icon, { 
          size: sz as number, 
          strokeWidth: 1, 
          shape: 'lined' 
        })
      }
    }
    resolvedTabIcons.value = map
  },
  { immediate: true },
)
</script>

<template>
  <div class="tabs-wrapper" :class="className">
    <ElTabs ref="elTabsRef" :id="id" :class="[className, { 'tabs-overflow-active': hasOverflow && overflowItems.some(i => i.name === activeKey) }]" :editable="editable" :type="type === 'card' ? 'card' : ''" :tab-position="position as any"
      v-model="activeKey" @tab-remove="handleTabRemove">
      <ElTabPane v-for="(item) in (hasOverflow ? visibleItems : items)" :key="item.name" :label="item.label" :disabled="item.disabled" :closable="item.closable ?? false" :name="item.name">
        <template #label v-if="item.icon && resolvedTabIcons[item.name]">
          <span class="item-content flex items-center">
            <component class="mr-1" :is="resolvedTabIcons[item.name]?.component"
              v-bind="resolvedTabIcons[item.name]?.props ?? {}"
              :color="activeKey === item.name
                ? 'var(--el-color-primary)'
                : undefined
              "
            />
            <span class="item-label leading-none">{{ item.label }}</span>
          </span>
        </template>
        <template v-if="typeof item.content === 'string'">
          {{ item.content }}
        </template>
        <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
      </ElTabPane>
    </ElTabs>
    <div v-if="hasOverflow && overflowItems.some(i => i.name === activeKey)" class="tabs-overflow-content">
      <template v-for="item in overflowItems" :key="item.name">
        <div v-show="item.name === activeKey">
          <template v-if="typeof item.content === 'string'">{{ item.content }}</template>
          <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
        </div>
      </template>
    </div>
    <ElDropdown v-if="hasOverflow" ref="overflowDropdownRef" trigger="click" placement="bottom-start" @command="handleOverflowSelect" @visible-change="(val: boolean) => overflowVisible = val">
      <div class="tabs-overflow-trigger" :class="{ 'is-active': overflowItems.some(i => i.name === activeKey), 'is-open': overflowVisible }" ref="overflowTriggerRef">
        <span>更多</span>
        <component v-if="overflowIconRef?.component" class="ml-1 tabs-overflow-arrow" :is="overflowIconRef.component" v-bind="overflowIconRef.props" />
      </div>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="item in overflowItems"
            :key="item.name"
            :command="item.name"
            :disabled="item.disabled"
            :class="{ 'is-active': item.name === activeKey }"
          >
            {{ item.label }}
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </div>
</template>
