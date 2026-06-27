<script setup lang="ts">
import { computed, ref } from "vue"
import { ElTabs, ElTabPane } from "element-plus"
import type { TabsNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import { getLucideIconComponentRef } from "../Icon/IconBase"
import "./Tabs.less"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}
const typeEnum = {
  line: "",
  card: "card",
  "editable-card": "card",
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

const { resolveValue } = useA2UIComponent(props.node, props.surfaceId)

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

const editable = computed(() => types.value === 'editable-card')

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


const items = computed(() => {
  const tabs = properties.children || []
  return tabs.map((item: any, index: number) => {
    const itemProps = item.properties

    const label = resolveValue(itemProps.label) as string
    const key = (resolveValue(itemProps.key) as string) || String(index)
    const icon = resolveValue(itemProps.icon) as string
    const disabled = resolveValue(itemProps.disabled) as boolean

    const content =
      itemProps.content?.path || typeof itemProps.content === "string"
        ? resolveValue(itemProps.content)
        : itemProps.content
    return {
      name: key,
      label: label,
      icon: icon,
      disabled: disabled,
      content: content,
    }
  })
})
</script>

<template>
  <ElTabs :id="id" :class="className" :editable="editable" :type="type === 'card' ? 'card' : ''" :tab-position="position as any"
    v-model="activeKey">
    <ElTabPane v-for="(item) in items" :key="item.name" :label="item.label" :disabled="item.disabled" :name="item.name">
      <template #label v-if="item.icon">
        <span class="item-content flex items-center">
          <component class="mr-1" :is="getLucideIconComponentRef(item.icon)" :color="activeKey === item.name
              ? 'var(--el-color-primary)'
              : undefined
            " :size="iconSize" :stroke-width="1" :absolute-stroke-width="true" />
          <span class="item-label leading-none">{{ item.label }}</span>
        </span>
      </template>
      <template v-if="typeof item.content === 'string'">
        {{ item.content }}
      </template>
      <ComponentNode v-else :node="item.content" :surface-id="surfaceId" />
    </ElTabPane>
  </ElTabs>
</template>
