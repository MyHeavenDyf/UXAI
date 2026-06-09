<script setup lang="ts">
import { computed } from "vue"
import type { A2UIComponentProps, AnyComponentNode } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const className = properties.className || ''
const { resolveValue } = useA2UIComponent(node, surfaceId)

const value = computed(() => {
  if (properties.value?.path) return resolveValue(properties.value) ?? 0
  return typeof properties.value === "number" ? properties.value : 0
})

const max = computed(() => {
  if (properties.max?.path) return resolveValue(properties.max) ?? 100
  return typeof properties.max === "number" ? properties.max : 100
})

const percent = computed(() => Math.min(100, Math.max(0, (value.value / max.value) * 100)))
const arcDash = computed(() => `${percent.value * 2.51} 251`)
</script>

<template>
  <div :class="className" class="pat-gauge">
    <svg viewBox="0 0 100 60" class="pat-gauge-svg">
      <defs>
        <linearGradient id="patGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0067D1" />
          <stop offset="100%" stop-color="#09AA71" />
        </linearGradient>
      </defs>
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#E6F2FD" stroke-width="8" stroke-linecap="round" />
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="url(#patGaugeGrad)" stroke-width="8" stroke-linecap="round" :stroke-dasharray="arcDash" />
      <line v-for="i in 10" :key="'tick-'+i" :x1="50 + 40 * Math.cos(Math.PI * (1 - i/10))" :y1="50 - 40 * Math.sin(Math.PI * (1 - i/10))" :x2="50 + 35 * Math.cos(Math.PI * (1 - i/10))" :y2="50 - 35 * Math.sin(Math.PI * (1 - i/10))" stroke="#C9C9C9" stroke-width="1" />
      <circle :cx="50 + 40 * Math.cos(Math.PI * (1 - percent/100))" :cy="50 - 40 * Math.sin(Math.PI * (1 - percent/100))" r="4" fill="#0067D1">
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="50" y="48" text-anchor="middle" class="pat-gauge-value">{{ Math.round(percent) }}%</text>
    </svg>
  </div>
</template>

<style scoped>
.pat-gauge-svg { width: 100%; height: auto; }
.pat-gauge-value { font-size: 16px; font-weight: 600; fill: #191919; }
</style>
