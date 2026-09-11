<script setup lang="ts">
import { computed } from "vue"

import { ComponentRegistry } from "../registry/ComponentRegistry"

import { useA2UIComponent } from "./hooks"
interface ComponentNodeProps {
  node: any
  surfaceId: string
  registry?: any
}
const props = defineProps<ComponentNodeProps>()
const actualRegistry = computed(
  () => props.registry ?? ComponentRegistry.getInstance()
)
const { resolveValue, setState, sendAction } = useA2UIComponent(props.node, props.surfaceId)
const nodeType = computed(() =>
  props.node && typeof props.node === "object" && "type" in props.node
    ? props.node.type
    : null
)
const Component = computed(() =>
  nodeType.value ? actualRegistry.value.get(nodeType.value) : null
)

const elementPropsJson = computed(() => {
  const raw = props.node.properties || {}
  const simple: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'children' || k === 'style') continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      simple[k] = v
    } else if (typeof v === 'object' && (v as any)?.path) {
      simple[k] = resolveValue(v as any)
      simple[`__bind_${k}`] = (v as any).path
    } else if (v != null) {
      simple[k] = v
    }
  }
  const styleObj = raw.style
  if (typeof styleObj === 'object' && styleObj) {
    for (const [sk, sv] of Object.entries(styleObj)) {
      if (typeof sv === 'string') simple[sk] = sv.replace(/ !important$/i, '')
    }
  }
  return JSON.stringify(simple)
})

// 原生 H5 元素（div/span/a…）的点击触发：把 props.onClick（setState 动作对象）转成真正的点击处理函数，
// 与 Button.handleClick 同构，使任意原生元素也能作为 setState 触发器（如切换 tab、打开抽屉）。
const clickHandler = computed<((e?: Event) => void) | null>(() => {
  const p = props.node.properties
  const onClick = p?.onClick
  if (onClick && onClick.action === "setState" && onClick.args?.path) {
    const { path, value } = onClick.args
    return (e?: Event) => {
      e?.preventDefault?.() // <a href> 不跳转；对 div/span 无害
      setState(path, value)
    }
  }
  // 兼容 Button 的 legacy action：派发用户动作到外层 host
  if (p?.action) {
    const a = p.action
    return () => sendAction(a)
  }
  return null
})

const bindProps = computed(() => {
  // 剥离 children/onClick/action：onClick 由 clickHandler 转为函数挂载，action 走 legacy 派发
  const { children, onClick, action, ...otherProps } = props.node.properties || {}
  const { value, ...otherNodeProps } = otherProps
  let propsObj: Record<string, any> = {}
  for (const [key, prop] of Object.entries(otherNodeProps)) {
    let rPorp = prop
    if (Object.prototype.toString.call(prop) === "[object Object]") {
      if ((prop as any)?.hasOwnProperty("path")) {
        rPorp = resolveValue(prop as any)
      }
    }
    propsObj[key] = rPorp
  }
  propsObj.id = props.node.id
  propsObj['dom-picker-component'] = nodeType.value
  propsObj['data-element-props'] = elementPropsJson.value
  const handler = clickHandler.value
  if (handler) propsObj.onClick = handler
  return propsObj
})
</script>
<template>
  <template v-if="nodeType">
    <template v-if="nodeType && !Component">
      <component :is="nodeType" v-bind="bindProps">
        <template v-if="props.node.properties.children?.length">
          <ComponentNode
            v-for="item in props.node.properties.children"
            :key="item.id"
            :node="item"
            :surfaceId="surfaceId"
            :registry="registry"
          />
        </template>
        <template v-else>
          {{ resolveValue(props.node.properties.value) }}
        </template>
      </component>
    </template>
    <template v-else-if="Component">
      <component :is="Component" :node="node" :surfaceId="surfaceId" :id="node.id" :dom-picker-component="nodeType" :data-element-props="elementPropsJson" />
    </template>
  </template>
</template>
