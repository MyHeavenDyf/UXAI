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
const { resolveValue } = useA2UIComponent(props.node, props.surfaceId)
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
    if (k === 'children') continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      simple[k] = v
    } else if (typeof v === 'object' && (v as any)?.path) {
      simple[k] = resolveValue(v as any)
      simple[`__bind_${k}`] = (v as any).path
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

const bindProps = computed(() => {
  const { children, ...otherProps } = props.node.properties
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
  propsObj['dom-picker-id'] = props.node.id
  propsObj['dom-picker-component'] = nodeType.value
  propsObj['data-element-props'] = elementPropsJson.value
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
      <component :is="Component" :node="node" :surfaceId="surfaceId" :dom-picker-id="node.id" :dom-picker-component="nodeType" :data-element-props="elementPropsJson" />
    </template>
  </template>
</template>
