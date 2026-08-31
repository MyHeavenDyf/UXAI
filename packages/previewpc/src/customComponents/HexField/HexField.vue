<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import type { HexFieldNode } from "../../components/types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./hex-field.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const props = defineProps<A2UIComponentProps<HexFieldNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, commitActivation } = useA2UIComponent(node, surfaceId)

// --- DOM attribute transfer for designer integration ---
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

// --- Value state ---
// External value is comma-separated (e.g. "52,61,72,21,1a,74,0,cf")
// Display value uses spaces between bytes (e.g. "52 61 72 21 1a 74 0 cf")
const initVal = computed(() => (resolveValue(properties.value) as string) ?? "")
const localValue = ref(formatDisplay(initVal.value))
watch(() => initVal.value, (nv) => {
  localValue.value = formatDisplay(nv)
})

// --- Convert comma-separated to space-separated for display ---
function formatDisplay(val: string): string {
  if (!val) return ""
  return val.split(",").map(b => b.trim().toLowerCase()).filter(b => b).join(" ")
}

// --- Convert display value back to comma-separated for data model ---
function formatCommit(val: string): string {
  if (!val) return ""
  return val.split(/[\s,]+/).map(b => b.trim().toLowerCase()).filter(b => b).join(",")
}

// --- Format on blur: normalize and commit ---
function onBlur() {
  if (!localValue.value) {
    commitActivation('value', localValue.value)
    return
  }
  const formatted = formatDisplay(localValue.value)
  if (formatted !== localValue.value) {
    localValue.value = formatted
  }
  commitActivation('value', formatCommit(localValue.value))
}

// --- Change handler ---
function onChange() {
  commitActivation('value', formatCommit(localValue.value))
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="hex-field"
    :class="[
      className,
      { 'hex-field--disabled': disabled }
    ]"
  >
    <input
      class="hex-field__input"
      type="text"
      v-model="localValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @blur="onBlur"
      @change="onChange"
    />
  </div>
</template>
