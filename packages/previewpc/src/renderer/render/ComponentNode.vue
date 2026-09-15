<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue"

import { ComponentRegistry } from "../registry/ComponentRegistry"

import { useA2UIComponent, executeAction } from "./hooks"
import { useA2UI } from "./Provider"
import type { ConditionSpec } from "../processor/type"
interface ComponentNodeProps {
  node: any
  surfaceId: string
  registry?: any
}
const props = defineProps<ComponentNodeProps>()
const actualRegistry = computed(
  () => props.registry ?? ComponentRegistry.getInstance()
)
const { resolveValue, setState, sendAction, getValue } = useA2UIComponent(props.node, props.surfaceId)
const { store } = useA2UI()
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

// 原生 H5 元素（div/span/a…）的点击触发：把 props.onClick（setState / cycleState 动作对象）转成真正的点击处理函数，
// 与 Button.handleClick 同构，使任意原生元素也能作为动作触发器（如切换 tab、打开抽屉、循环场景）。
// 注意：这是 computed，不能在求值期调用 executeAction（会副作用改状态、触发更新循环），
// 因此只判断动作名，真正的执行推迟到返回的点击闭包内（点击时读 getValue 才正确）。
const clickHandler = computed<((e?: Event) => void) | null>(() => {
  const p = props.node.properties
  const onClick = p?.onClick
  const isManagedAction = onClick && (onClick.action === "setState" || onClick.action === "cycleState")
  if (isManagedAction) {
    return (e?: Event) => {
      e?.preventDefault?.() // <a href> 不跳转；对 div/span 无害
      executeAction(onClick, { getValue, setState })
    }
  }
  // 兼容 Button 的 legacy action：派发用户动作到外层 host
  if (p?.action) {
    const a = p.action
    return () => sendAction(a)
  }
  return null
})

// condition 条件渲染：节点带 condition 时，仅当 path 当前值在 in 列表中才挂载。
// componentTree 是静态构建的，故这里复刻 Modal 的订阅模式，在 store notify 时重新求值。
const condition = computed(() => props.node?.condition as ConditionSpec | undefined)
const conditionSatisfied = ref(true) // 默认 true：无 condition 的节点正常渲染

const evalCondition = () => {
  const c = condition.value
  if (!c) {
    conditionSatisfied.value = true
    return
  }
  const current = getValue(c.path)
  const currentStr = current == null ? "" : String(current)
  conditionSatisfied.value = c.in.map(String).includes(currentStr)
}

// 同步初值：在 setup 期就求值一次，避免首帧把不满足条件的节点闪现出来。
if (condition.value) {
  evalCondition()
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  if (!condition.value) return // 无 condition → 不订阅，零开销
  unsubscribe = store.subscribeToSurface(props.surfaceId, evalCondition)
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
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
  <template v-if="nodeType && conditionSatisfied">
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
