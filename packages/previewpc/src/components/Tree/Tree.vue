<script setup lang="ts">
import { computed, onMounted, ref, useAttrs, watch } from "vue"
import type { Component } from "vue"
import { ElTree } from "element-plus"
import type { TreeNodeNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getIconComponentRef } from "../Icon/IconBase"
import "./Tree.less"

interface TreeNodeData {
  label: string
  id: string
  icon?: Component
  children?: TreeNodeData[]
}

interface RawNode {
  label: string
  id: string
  iconName?: string
  children?: RawNode[]
}

const props = defineProps<A2UIComponentProps<TreeNodeNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")
const checkable = computed(() => properties.checkable || false)

const defaultExpandedKeys = computed(() => {
  const raw = properties.defaultExpandedKeys
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((item: any) => {
      if (typeof item === "object" && "path" in item) {
        return resolveValue(item)
      }
      return item
    })
  }
  if (typeof raw === "object" && "path" in raw) {
    const resolved = resolveValue(raw)
    return Array.isArray(resolved) ? resolved : []
  }
  return []
})

const defaultSelectedKeys = computed(() => {
  const raw = properties.defaultSelectedKeys
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((item: any) => {
      if (typeof item === "object" && "path" in item) {
        return resolveValue(item)
      }
      return item
    })
  }
  if (typeof raw === "object" && "path" in raw) {
    const resolved = resolveValue(raw)
    return Array.isArray(resolved) ? resolved : []
  }
  return []
})

function toRawNode(node: any): RawNode {
  const children = node.children
    ? Array.isArray(node.children)
      ? node.children.map(toRawNode)
      : []
    : undefined
  return {
    label: node.title ?? "",
    id: node.key,
    iconName: node.icon || undefined,
    ...(children ? { children } : {}),
  }
}

const rawTreeData = computed<RawNode[]>(() => {
  const raw = properties.options
  let opts: any[] = []
  if (Array.isArray(raw)) {
    opts = raw
  } else if (raw && typeof raw === "object" && "path" in raw) {
    const resolved = resolveValue(raw) as any
    opts = Array.isArray(resolved) ? resolved : []
  }
  return opts.map(toRawNode)
})

// ---- 异步图标解析 ----
async function resolveIcons(nodes: RawNode[]): Promise<TreeNodeData[]> {
  return Promise.all(
    nodes.map(async (node) => {
      let icon: Component | undefined
      if (node.iconName) {
        const refComp = await getIconComponentRef(node.iconName, { size: 14 })
        icon = refComp?.component ?? undefined
      }
      return {
        label: node.label,
        id: node.id,
        icon,
        ...(node.children ? { children: await resolveIcons(node.children) } : {}),
      }
    }),
  )
}

const treeData = ref<TreeNodeData[]>([])

watch(
  rawTreeData,
  async (raw) => {
    treeData.value = await resolveIcons(raw)
  },
  { immediate: true, deep: true },
)

// ---- 展开/折叠图标 ----
const expandIcon = ref<Component>()
getIconComponentRef("chevron-right").then((r) => {
  expandIcon.value = r?.component ?? undefined
})

const treeRef = ref<InstanceType<typeof ElTree>>()

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

onMounted(() => {
  const wrapper = (treeRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

watch(defaultSelectedKeys, (keys) => {
  if (keys.length > 0) {
    treeRef.value?.setCurrentKey(keys[0] as string)
  }
}, { immediate: true })

const handleCheck = () => {
  if (!treeRef.value) return
  const checkedKeys = treeRef.value.getCheckedKeys()
  setValue("/checkedKeys", checkedKeys)
}

const handleNodeClick = (data: TreeNodeData) => {
  setValue("/selectedKey", data.id)
}
</script>

<template>
  <ElTree
    ref="treeRef"
    :id="id"
    :class="className"
    :data="treeData"
    node-key="id"
    label="label"
    :icon="expandIcon"
    :show-checkbox="checkable"
    :default-expanded-keys="defaultExpandedKeys"
    :highlight-current="!checkable"
    :current-node-key="defaultSelectedKeys[0]"
    default-expand-all
    @check="handleCheck"
    @node-click="handleNodeClick"
  >

    <template #default="{ node: treeNode, data }">
      <span class="custom-tree-node">
        <component v-if="data.icon" :is="data.icon" :size="14" style="margin-right: 4px;" />
        <span>{{ treeNode.label }}</span>
      </span>
    </template>
  </ElTree>
</template>

<style scoped>
.custom-tree-node {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>