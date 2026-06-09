<script setup lang="ts">
import { computed } from "vue"
import type { A2UIComponentProps, AnyComponentNode } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const className = properties.className || ''
const { resolveValue } = useA2UIComponent(node, surfaceId)

const normal = computed(() => {
  if (properties.normal?.path) return resolveValue(properties.normal) ?? 0
  return typeof properties.normal === "number" ? properties.normal : 0
})
const warning = computed(() => {
  if (properties.warning?.path) return resolveValue(properties.warning) ?? 0
  return typeof properties.warning === "number" ? properties.warning : 0
})
const danger = computed(() => {
  if (properties.danger?.path) return resolveValue(properties.danger) ?? 0
  return typeof properties.danger === "number" ? properties.danger : 0
})
const error = computed(() => {
  if (properties.error?.path) return resolveValue(properties.error) ?? 0
  return typeof properties.error === "number" ? properties.error : 0
})

const total = computed(() => normal.value + warning.value + danger.value + error.value)

const segments = computed(() => [
  { label: "正常", value: normal.value, color: "#09AA71" },
  { label: "告警", value: warning.value, color: "#FCC800" },
  { label: "危险", value: danger.value, color: "#F4840C" },
  { label: "错误", value: error.value, color: "#E02128" },
])

const barWidth = (val: number) => total.value > 0 ? (val / total.value) * 100 : 0
</script>

<template>
  <div :class="className" class="pat-stacked-bar">
    <div class="pat-stacked-bar-track">
      <div
        v-for="(seg, i) in segments"
        :key="i"
        class="pat-stacked-bar-segment"
        :style="{ width: barWidth(seg.value) + '%', backgroundColor: seg.color }"
      />
    </div>
    <div class="pat-stacked-bar-legend">
      <div v-for="(seg, i) in segments" :key="'legend-'+i" class="pat-stacked-bar-legend-item">
        <span class="pat-stacked-bar-dot" :style="{ backgroundColor: seg.color }" />
        <span class="pat-stacked-bar-label">{{ seg.label }}</span>
        <span class="pat-stacked-bar-count">{{ seg.value }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pat-stacked-bar { width: 100%; }
.pat-stacked-bar-track {
  display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #F3F3F3;
}
.pat-stacked-bar-segment {
  transition: width 0.5s ease; min-width: 0;
}
.pat-stacked-bar-legend {
  display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;
}
.pat-stacked-bar-legend-item {
  display: flex; align-items: center; gap: 4px; font-size: 12px; color: #777777;
}
.pat-stacked-bar-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pat-stacked-bar-count { font-weight: 600; color: #191919; }
</style>
