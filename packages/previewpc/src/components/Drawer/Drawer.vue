<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { ElDrawer } from "element-plus"
import type { DrawerNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { useA2UI } from "../../renderer/render/Provider"
import ComponentNode from "../../renderer/render/ComponentNode.vue"

const props = defineProps<A2UIComponentProps<DrawerNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue, setState, getValue } = useA2UIComponent(node, surfaceId)
const { store } = useA2UI()

// 从 onClose 取绑定路径（open 与 onClose 指向同一个 state key）
const bindingPath = computed(() => {
  const onClose = properties.onClose
  if (onClose?.action === "setState" && onClose.args?.path) {
    return onClose.args.path
  }
  return null
})

const localOpen = ref(false)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  if (bindingPath.value) {
    localOpen.value = !!getValue(bindingPath.value)
  }

  unsubscribe = store.subscribeToSurface(surfaceId, () => {
    if (bindingPath.value) {
      localOpen.value = !!getValue(bindingPath.value)
    }
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})

const id = computed(() => node.id)
const className = computed(() => properties.className)
const title = computed(() => resolveValue(properties.title) as string || "")
const placementEnum: Record<string, string> = {
  right: "rtl",
  left: "ltr",
  top: "ttb",
  bottom: "btt",
}
const placement = computed<"ltr" | "rtl" | "ttb" | "btt">(() => {
  return (placementEnum[properties.placement || "right"] || "rtl") as "ltr" | "rtl" | "ttb" | "btt"
})
const mask = computed(() => properties.mask !== false)
const width = computed(() => properties.width ?? 300)
const footer = computed(() => properties.footer)
const children = computed(() => properties.children)

function handleClose() {
  localOpen.value = false
  const onClose = properties.onClose
  if (!onClose) return
  if (onClose.action === "setState" && onClose.args) {
    const { path, value } = onClose.args
    if (path) setState(path, value)
  }
}
</script>

<template>
  <ElDrawer
    :id="id"
    :class="className"
    :model-value="localOpen"
    :title="title"
    :size="width"
    :direction="placement"
    :show-close="true"
    :close-on-click-modal="mask"
    :close-on-press-escape="true"
    @update:model-value="(val: boolean) => { if (!val) handleClose() }"
    @close="handleClose"
  >
    <template v-if="children?.length">
      <ComponentNode
        v-for="child in children"
        :key="child.id"
        :node="child"
        :surfaceId="surfaceId"
      />
    </template>
    <template v-if="footer" #footer>
      <ComponentNode
        :node="footer"
        :surfaceId="surfaceId"
      />
    </template>
  </ElDrawer>
</template>
<style lang="less">
.el-drawer__header {
  padding: 24px;
  padding-bottom: 0;
  margin-bottom: 16px;
  font-size: 20px;
  .el-icon.el-drawer__close {
    font-size: 23px;
  }
}
.el-drawer__body {
  padding: 24px;
  padding-top: 0;
}
</style>