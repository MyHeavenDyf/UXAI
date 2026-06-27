<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { ElSelect, ElOption, ElCheckbox } from "element-plus"
import type { SelectNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./Select.less"

const sizeEnum = {
  large: "large",
  medium: "default",
  small: "small",
}

const props = defineProps<A2UIComponentProps<SelectNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const id = computed(() => node.id)
const className = computed(() => node.properties.className)

const placeholder = computed(
  () => resolveValue(properties.placeholder) as string
)
const size = computed(() => {
  return properties.size ? (sizeEnum[properties.size] as any) : ""
})
const multiple = computed(() => properties.mode === "multiple")
const filterable = computed(() => properties.showSearch)

const options = computed(() => {
  const opts = node.properties.options
  if (Array.isArray(opts)) {
    return opts.map((item) => {
      return {
        value: resolveValue(item.value),
        label: resolveValue(item.label),
      }
    })
  }
  return resolveValue(opts) as []
})

const initVal = computed(() => {
  const val = resolveValue(properties.value)
  // 多选模式下，确保初始值为数组
  if (multiple.value && !Array.isArray(val)) {
    return val ? [val] : []
  }
  return val as any
})
const selectValue = ref(initVal.value)

onMounted(() => {
  handleChange(initVal.value)
})

// 判断某个选项是否被选中
function isChecked(itemValue: any) {
  return Array.isArray(selectValue.value) && selectValue.value.includes(itemValue)
}

// 切换 checkbox 选中状态
function toggleCheck(item: any) {
  if (!Array.isArray(selectValue.value)) {
    selectValue.value = []
  }
  const index = selectValue.value.indexOf(item.value)
  if (index === -1) {
    // 选中：添加到数组
    selectValue.value = [...selectValue.value, item.value]
  } else {
    // 取消选中：从数组移除
    selectValue.value = selectValue.value.filter((v: any) => v !== item.value)
  }
  handleChange(selectValue.value)
}

function handleChange(value: any) {
  const path = (properties.value as any)?.path
  if (!path) return

  if (multiple.value && Array.isArray(value)) {
    // 多选模式：设置选中的 label 数组
    const selectedLabels = value.map((val: any) => {
      const temp = options.value?.find((i: any) => i.value === val)
      return temp?.label || val
    })
    setValue(path, selectedLabels)
  } else {
    // 单选模式
    const temp = options.value?.find((i: any) => i.value === value)
    setValue(path, temp?.label || "")
  }
}
</script>

<template>
  <ElSelect
    :id="id"
    :class="className"
    :size="size"
    :multiple="multiple"
    :filterable="filterable"
    :placeholder="placeholder"
    v-model="selectValue"
    @change="handleChange"
  >
    <template v-if="multiple">
      <ElOption
          v-for="item in options"
          :key="(item.value as any)"
          :value="(item.value as any)"
          :label="(item.label as any)"
      >
        <ElCheckbox
          :model-value="isChecked(item.value)"
          @click.stop
          @change="() => toggleCheck(item)"
        >
          {{ item.label }}
        </ElCheckbox>
      </ElOption>
    </template>
    <template v-else>
      <ElOption
        v-for="item in options"
        :key="(item.value as any)"
        :value="(item.value as any)"
        :label="(item.label as any)"/>
    </template> 
  </ElSelect>
</template>