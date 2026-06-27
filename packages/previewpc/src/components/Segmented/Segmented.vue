<script setup lang="ts">
import { computed, ref } from "vue"
import { ElSegmented } from "element-plus"
import type { SegmentedNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getLucideIconComponentRef } from "../Icon/IconBase"
import "./Segmented.less"

const sizeEnum: Record<string, "" | "small" | "large" | "default" | undefined> = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<SegmentedNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => properties.className || "")

const normalizedOptions = computed(() => {
  const raw = properties.options
  let opts: any[] = []
  if (Array.isArray(raw)) {
    opts = raw
  } else {
    const resolved = resolveValue(raw) as any
    opts = Array.isArray(resolved) ? resolved : []
  }

  return opts.map((item) => {
    if (typeof item === "string" || typeof item === "number") {
      return { label: String(item), value: item }
    }
    const iconComponent = item.icon
      ? getLucideIconComponentRef(item.icon)
      : undefined
    return {
      label: item.label ?? String(item.value),
      value: item.value,
      icon: iconComponent,
    }
  })
})


const initvalue = computed(() => {
  const raw = properties.value
  if (raw && typeof raw === "object" && "path" in raw) {
    return resolveValue(raw) as string | number
  }
  return raw as string | number
})
const currentValue = ref(initvalue.value)

const block = computed(() => properties.block || false)
const direction = computed(() => properties.orientation || "horizontal")
const size = computed(() => {
  return (properties.size ? sizeEnum[properties.size] : "default") 
})

const handleChange = (val: string | number) => {
  const raw = properties.value
  if (raw && typeof raw === "object" && "path" in raw) {
    setValue(raw.path, val)
  }
}
</script>

<template>
  <ElSegmented
    :id="id"
    :class="className"
    v-model="currentValue"
    :options="normalizedOptions"
    :direction
    :size="size"
    :block="block"
    @update:model-value="handleChange"
  />
</template>