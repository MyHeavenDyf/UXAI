<template>
  <div ref="chartRef" class="vue-stacked-bar-component" :class="className"></div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { StackedBarChart } from './stacked-bar-core.js';
import type { A2UIComponentProps, AnyComponentNode } from '../../renderer';
import { useA2UIComponent } from '../../renderer';
import './stacked-bar.css';

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const { resolveValue } = useA2UIComponent(node, surfaceId)

const normal = computed(() => {
  return (resolveValue(node.properties.normal as any) as number) ?? 0
})

const warning = computed(() => {
  return (resolveValue(node.properties.warning as any) as number) ?? 0
})

const danger = computed(() => {
  return (resolveValue(node.properties.danger as any) as number) ?? 0
})

const error = computed(() => {
  return (resolveValue(node.properties.error as any) as number) ?? 0
})

const className = computed(() => {
  return (resolveValue(node.properties.className as any) as string) ?? ''
})

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: any = null;

// 将外部传入的四个独立状态整合为核心类所需的数据结构，并注入标准颜色
const getChartData = () => [
  { label: '正常', value: normal.value, color: '#10b981' }, // 绿色
  { label: '告警', value: warning.value, color: '#facc15' }, // 黄色
  { label: '危险', value: danger.value, color: '#f97316' },  // 橙色
  { label: '错误', value: error.value, color: '#ef4444' }    // 红色
];

// 初始化
onMounted(() => {
  if (chartRef.value) {
    chartInstance = new StackedBarChart(chartRef.value);
    chartInstance.render(getChartData());
  }
});

// 监听状态值变化，触发重绘动画
watch(
  [normal, warning, danger, error],
  () => {
    if (chartInstance) {
      chartInstance.render(getChartData());
    }
  }
);

// 销毁实例防止内存泄漏
onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});
</script>

<style scoped>
.vue-stacked-bar-component {
  width: 100%;
}
</style>