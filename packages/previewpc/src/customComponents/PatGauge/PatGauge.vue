<template>
  <div ref="chartRef" class="vue-gauge-dashboard-component" :class="className"></div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { GaugeChart } from './gauge-core.js';
import type { A2UIComponentProps, AnyComponentNode } from '../../renderer';
import { useA2UIComponent } from '../../renderer';
import './gauge.css';

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const { resolveValue } = useA2UIComponent(node, surfaceId)

const gaugeValue = computed(() => {
  return (resolveValue(node.properties.value as any) as number) ?? 0
})

const gaugeMax = computed(() => {
  return (resolveValue(node.properties.max as any) as number) ?? 100
})
const className = computed(() => {
  return (resolveValue(node.properties.className as any) as string) ?? ''
})


const chartRef = ref<HTMLElement | null>(null);
let chartInstance: any = null;

onMounted(() => {
  if (chartRef.value) {
    chartInstance = new GaugeChart(chartRef.value, { max: gaugeMax.value });
    chartInstance.render(gaugeValue.value);
  }
});

// 监听数值变化，调用底层原生类的渲染方法
watch(
  gaugeValue,
  (newValue) => {
    if (chartInstance) {
      chartInstance.render(newValue);
    }
  }
);

// 监听 max 最大值变更（重置实例）
watch(
  gaugeMax,
  (newMax) => {
    if (chartInstance && chartRef.value) {
      chartInstance.destroy();
      chartInstance = new GaugeChart(chartRef.value, { max: newMax });
      chartInstance.render(gaugeValue.value);
    }
  }
);

onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});
</script>

<style scoped>
.vue-gauge-dashboard-component {
  width: 100%;
}
</style>