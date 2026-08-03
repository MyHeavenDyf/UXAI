<script setup lang="ts">
import { computed, ref, useAttrs, watch } from "vue"
import { ElSegmented } from "element-plus"
import type { SegmentedNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { getIconComponentRef } from "../Icon/IconBase"
import { svgCacheVersion } from "../../composables/useIconProvider"

import "./Segmented.less"

const sizeEnum: Record<string, "" | "small" | "large" | "default" | undefined> = {
  large: "large",
  medium: "default",
  small: "small",
}

const iconSizeEnum: Record<string, number> = {
  large: 16,
  default: 14,
  small: 12,
}

const props = defineProps<A2UIComponentProps<SegmentedNode>>()
const { node, surfaceId } = props
const properties = node.properties
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const elSegmentedRef = ref<any>()

const applyPickerAttrs = () => {
  const wrapper = (elSegmentedRef.value as any)?.$el
  if (!(wrapper instanceof HTMLElement)) return
  if (attrs['id'] != null)
    wrapper.setAttribute('id', String(attrs['id']))
  if (attrs['dom-picker-component'] != null)
    wrapper.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
  if (attrs['data-element-props'] != null)
    wrapper.setAttribute('data-element-props', String(attrs['data-element-props']))
}

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

const size = computed(() => properties.size ? sizeEnum[properties.size] : "default")
const iconSize = computed(() => iconSizeEnum[size.value ?? "default"] ?? iconSizeEnum.default)

// 参考 Button 的图标处理：区分 hui / lucide，按尺寸取大小；颜色按选中态动态计算
const resolveOptionIcon = (iconName: string | undefined) => {
  if (!iconName) return null
  const base = getIconComponentRef(iconName, { strokeWidth: 1 })
  if (!base?.component) return null
  return {
    component: base.component,
    isHui: "iconColor" in base.props,
    baseProps: base.props,
    size: iconSize.value,
  }
}

// 选中态：白色；未选中：跟随分段控制器文本色。响应 currentValue 变化重新求值
const iconAttrs = (item: any) => {
  const ic = item.icon
  if (!ic) return {}
  const selected = item.value === currentValue.value
  const color = selected ? "var(--el-segmented-item-selected-color)" : "var(--el-segmented-color)"
  return ic.isHui
    ? { ...ic.baseProps, size: ic.size, type: ic.baseProps.type, iconColor: [color] }
    : { size: ic.size, color, "stroke-width": 1 }
}

const resolvedOptions = ref<any[]>([])

watch(
  [normalizedOptions, svgCacheVersion, iconSize],
  ([opts]) => {
    resolvedOptions.value = opts.map((opt: any) => ({
      label: opt.label,
      value: opt.value,
      icon: resolveOptionIcon(opt.iconName),
    }))
  },
  { immediate: true },
)

// ElSegmented 根 div 用 v-if="options.length" 控制渲染，resolvedOptions 异步更新，
// onMounted 时 $el 还是注释节点，需在 options 就绪、DOM 更新后再挂属性
watch(resolvedOptions, applyPickerAttrs, { flush: 'post', immediate: true })

// 纯图标：所有项都有图标且无文字，收紧每项内边距
const isIconOnly = computed(() =>
  resolvedOptions.value.length > 0 &&
  resolvedOptions.value.every((opt: any) => opt.icon && !opt.label),
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
const disabled = computed(() => (resolveValue(properties.disabled) as boolean) || false)

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
    :class="[className, { 'icon-only': isIconOnly }]"
    v-model="currentValue"
    :options="resolvedOptions"
    :direction
    :size="size"
    :disabled="disabled"
    :block="block"
    @update:model-value="handleChange">
    <template #default="{ item }">
      <component
        v-if="item.icon"
        :is="item.icon.component"
        v-bind="iconAttrs(item)"
        class="segmented-item-icon"
      />
      <span v-if="item.label">{{ item.label }}</span>
    </template>
  </ElSegmented>
</template>