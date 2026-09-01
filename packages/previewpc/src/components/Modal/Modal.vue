<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { ElDialog } from "element-plus"
import type { ModalNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { useA2UI } from "../../renderer/render/Provider"
import ComponentNode from "../../renderer/render/ComponentNode.vue"

const props = defineProps<A2UIComponentProps<ModalNode>>()
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

// 订阅 store 通知，同步 state 到 localOpen
let unsubscribe: (() => void) | null = null

onMounted(() => {
  // 初始状态
  if (bindingPath.value) {
    localOpen.value = !!getValue(bindingPath.value)
  }

  // 监听 store 变化（setState 会触发 notify）
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
const mask = computed(() => properties.mask !== false)
const width = computed(() => properties.width ?? 520)
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
  <ElDialog
    :id="id"
    :class="className"
    :model-value="localOpen"
    :title="title"
    :width="width"
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
  </ElDialog>
</template>
<style lang="less">
.el-dialog{
  --el-dialog-border-radius: var(--radius-lg, 8px);
  padding:24px;
}
.el-dialog__headerbtn {
  top: 20px;
  right: 20px;
  width: 24px;
  height: 24px;
}
.el-icon.el-dialog__close {
  font-size: 23px;
}
.el-dialog__title {
  font-size:20px;
  line-height: 28px;
}
</style>