<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import { ElInput, ElSelect, ElOption } from "element-plus"
import type { CategoryInputNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./CategoryInput.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const props = defineProps<A2UIComponentProps<CategoryInputNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, commitActivation } = useA2UIComponent(node, surfaceId)

// --- DOM attribute transfer ---
const wrapperRef = ref<HTMLElement>()
onMounted(() => {
  if (wrapperRef.value) {
    if (attrs['id'] != null)
      wrapperRef.value.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapperRef.value.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapperRef.value.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

// --- Resolved props ---
const className = computed(() => properties.className || "")
const placeholder = computed(() => (resolveValue(properties.placeholder) as string) || "")
const disabled = computed(() => (resolveValue(properties.disabled) as boolean) || false)
const inputPosition = computed(() => properties.inputPosition || "right")

// --- Category options ---
const categoryOptions = computed(() => {
  const opts = properties.categoryOptions
  if (Array.isArray(opts)) return opts
  const resolved = resolveValue(opts as any)
  return Array.isArray(resolved) ? resolved : []
})

// --- Category state ---
const initCategory = computed(() => resolveValue(properties.category as any))
const categoryValue = ref<any>(initCategory.value)
watch(() => initCategory.value, (nv) => {
  categoryValue.value = nv
})

function onCategoryChange(val: any) {
  commitActivation('category', val)
}

// --- Input value state ---
const initVal = computed(() => (resolveValue(properties.value) as string) ?? "")
const inputValue = ref(initVal.value)
watch(() => initVal.value, (nv) => {
  inputValue.value = nv
})

function onInputChange(val: string) {
  commitActivation('value', val)
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="category-input"
    :class="[
      className,
      `category-input--${inputPosition}`,
      { 'category-input--disabled': disabled }
    ]"
  >
    <ElSelect
      v-if="inputPosition === 'left'"
      v-model="categoryValue"
      :disabled="disabled"
      class="category-input__select"
      @change="onCategoryChange"
    >
      <ElOption
        v-for="item in categoryOptions"
        :key="item.value"
        :label="item.text"
        :value="item.value"
      />
    </ElSelect>
    <ElInput
      v-model="inputValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="category-input__input"
      @change="onInputChange"
    />
    <ElSelect
      v-if="inputPosition === 'right'"
      v-model="categoryValue"
      :disabled="disabled"
      class="category-input__select"
      @change="onCategoryChange"
    >
      <ElOption
        v-for="item in categoryOptions"
        :key="item.value"
        :label="item.text"
        :value="item.value"
      />
    </ElSelect>
  </div>
</template>
