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

const bindProps = computed(() => {
  const { children, ...otherProps } = props.node.properties
  const { value, ...otherNodeProps } = otherProps
  let propsObj = {}
  for (const [key, prop] of Object.entries(otherNodeProps)) {
    let rPorp = prop
    if (Object.prototype.toString.call(prop) === "[object Object]") {
      if (prop?.hasOwnProperty("path")) {
        rPorp = resolveValue(prop)
      }
    }
    propsObj[key] = rPorp
  }
  propsObj['dom-picker-id'] = props.node.id
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
      <component :is="Component" :node="node" :surfaceId="surfaceId" :dom-picker-id="node.id" />
    </template>
  </template>
</template>
