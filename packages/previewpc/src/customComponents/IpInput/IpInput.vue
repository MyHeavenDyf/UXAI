<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick, useAttrs } from "vue"
import type { IpInputNode } from "../../components/types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./ip-input.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const props = defineProps<A2UIComponentProps<IpInputNode>>()
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
const disabled = computed(() => (resolveValue(properties.disabled) as boolean) || false)
const addressType = computed(() => properties.type || "v4")
const delimiter = computed(() => {
  if (properties.delimiter) return properties.delimiter
  switch (addressType.value) {
    case "v6": return ":"
    case "mac": return "-"
    default: return "."
  }
})

// --- Segment configuration by type ---
const segmentConfig = computed(() => {
  switch (addressType.value) {
    case "v4":  return { count: 4,  maxLength: 3 }
    case "v6":  return { count: 8,  maxLength: 4 }
    case "mac": return { count: 6,  maxLength: 2 }
    default:    return { count: 4,  maxLength: 3 }
  }
})

// --- Parse incoming value string into segments ---
function parseValue(val: string): string[] {
  const count = segmentConfig.value.count
  if (!val) return Array(count).fill("")
  const parts = val.split(delimiter.value)
  return Array.from({ length: count }, (_, i) => parts[i] ?? "")
}

// --- Join segments back to value string ---
function joinSegments(segs: string[]): string {
  return segs.join(delimiter.value)
}

// --- Value state ---
const initVal = computed(() => (resolveValue(properties.value) as string) ?? "")
const segments = ref<string[]>(parseValue(initVal.value))

watch(() => initVal.value, (nv) => {
  segments.value = parseValue(nv)
})

// --- Refs for per-segment input elements ---
const segmentRefs = ref<HTMLInputElement[]>([])

// --- Keydown handler for delimiter auto-advance ---
function onSegmentKeydown(index: number, event: KeyboardEvent) {
  const key = event.key

  // On delimiter key: advance to next segment
  if (key === delimiter.value) {
    if (segments.value[index]) {
      event.preventDefault()
      const nextIndex = index + 1
      if (nextIndex < segmentConfig.value.count) {
        segmentRefs.value[nextIndex]?.focus()
        segmentRefs.value[nextIndex]?.select()
      }
    }
    return
  }

  // On Backspace with empty segment: move to previous segment
  if (key === "Backspace" && !segments.value[index] && index > 0) {
    event.preventDefault()
    const prevIndex = index - 1
    segmentRefs.value[prevIndex]?.focus()
  }
}

// --- Input handler with character filtering and auto-advance ---
function onSegmentInput(index: number, event: Event) {
  const input = event.target as HTMLInputElement
  let val = input.value

  // Enforce type-specific character filtering
  switch (addressType.value) {
    case "v4":
      val = val.replace(/[^0-9]/g, "")
      break
    case "v6":
    case "mac":
      val = val.replace(/[^0-9a-fA-F]/g, "")
      break
  }

  // Enforce max length
  val = val.slice(0, segmentConfig.value.maxLength)
  segments.value[index] = val
  input.value = val

  // Auto-advance when segment is fully filled
  if (val.length >= segmentConfig.value.maxLength) {
    const nextIndex = index + 1
    if (nextIndex < segmentConfig.value.count) {
      nextTick(() => {
        segmentRefs.value[nextIndex]?.focus()
        segmentRefs.value[nextIndex]?.select()
      })
    }
  }

  commitValue()
}

// --- Blur handler: normalize and commit ---
function onSegmentBlur(index: number) {
  let val = segments.value[index]
  if (!val) {
    commitValue()
    return
  }

  // Normalize: lowercase for hex types
  if (addressType.value === "v6" || addressType.value === "mac") {
    val = val.toLowerCase()
  }

  // Clamp for v4
  if (addressType.value === "v4") {
    const num = Number(val)
    if (num > 255) val = "255"
  }

  segments.value[index] = val
  commitValue()
}

// --- Writeback ---
function commitValue() {
  const valueStr = joinSegments(segments.value)
  commitActivation('value', valueStr)
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="ip-input"
    :class="[
      className,
      `ip-input--${addressType}`,
      { 'ip-input--disabled': disabled }
    ]"
  >
    <template v-for="(_, index) in segmentConfig.count" :key="index">
      <input
        :ref="(el: any) => { if (el) segmentRefs[index] = el as HTMLInputElement }"
        class="ip-input__segment"
        type="text"
        :value="segments[index]"
        :maxlength="segmentConfig.maxLength"
        :disabled="disabled"
        @input="onSegmentInput(index, $event)"
        @keydown="onSegmentKeydown(index, $event)"
        @blur="onSegmentBlur(index)"
      />
      <span
        v-if="index < segmentConfig.count - 1"
        class="ip-input__delimiter"
      >{{ delimiter }}</span>
    </template>
  </div>
</template>
