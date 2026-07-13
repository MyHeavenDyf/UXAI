<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ElTree } from "element-plus"
import type { TreeNodeNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getLucideIconComponentRef } from "../Icon/IconBase"
import type { Component } from "vue"
import "./Tree.less"

interface TreeNodeData {
  label: string
  id: string
  icon?: Component
  children?: TreeNodeData[]
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

function transformNode(node: any): TreeNodeData {
  const iconComponent = node.icon
    ? getLucideIconComponentRef(node.icon)
    : undefined
  const children = node.children
    ? Array.isArray(node.children)
      ? node.children.map(transformNode)
      : []
    : undefined
  return {
    label: node.title ?? "",
    id: node.key,
    icon: iconComponent,
    ...(children ? { children } : {}),
  }
}

const treeData = computed<TreeNodeData[]>(() => {
  const raw = properties.options
  let opts: any[] = []
  if (Array.isArray(raw)) {
    opts = raw
  } else if (raw && typeof raw === "object" && "path" in raw) {
    const resolved = resolveValue(raw) as any
    opts = Array.isArray(resolved) ? resolved : []
  }
  return opts.map(transformNode)
})

const treeRef = ref<InstanceType<typeof ElTree>>()

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
    :icon="getLucideIconComponentRef('chevron-right')"
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