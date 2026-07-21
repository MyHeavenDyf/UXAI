<script setup lang="ts">
import { computed, onMounted, ref, useAttrs, watch } from "vue"
import { ElSegmented } from "element-plus"
import type { SegmentedNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getIconComponentRef } from "../Icon/IconBase"
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

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elSegmentedRef = ref<any>()

onMounted(() => {
  const wrapper = (elSegmentedRef.value as any)?.$el
  if (wrapper instanceof HTMLElement) {
    if (attrs['id'] != null)
      wrapper.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

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
    return {
      label: item.label ?? String(item.value),
      value: item.value,
      iconName: item.icon as string | undefined,
    }
  })
})

// ---- 异步图标解析 ----
const resolvedOptions = ref<any[]>([])

watch(
  normalizedOptions,
  async (opts) => {
    const results = await Promise.all(
      opts.map(async (opt: any) => {
        if (!opt.iconName) return { label: opt.label, value: opt.value, icon: undefined }
        const ref = await getIconComponentRef(opt.iconName)
        return { label: opt.label, value: opt.value, icon: ref?.component ?? undefined }
      }),
    )
    resolvedOptions.value = results
  },
  { immediate: true },
)


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
    ref="elSegmentedRef"
    :id="id"
    :class="className"
    v-model="currentValue"
    :options="resolvedOptions"
    :direction
    :size="size"
    :block="block"
    @update:model-value="handleChange"
  />
</template>