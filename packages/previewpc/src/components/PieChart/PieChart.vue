<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'

import type { A2UIComponentProps, AnyComponentNode } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import { useTheme } from "../../composables/useTheme";
import HuiCharts from '@hui/charts'
import './PieChart.less'

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const type = props.node.type
const className = properties.className || ''
const chartRef = ref<HTMLElement | null>(null)
const { resolveValue } = useA2UIComponent(node, surfaceId)

// 主题切换（全局状态）
const { isDark } = useTheme();

const getChartData = () => {
    const opt = properties.option as any
    let data = opt?.data || []
    if (opt?.data?.path) {
        data = resolveValue(opt?.data) || []
    }
    return data
}

const defOption: any = {
  legend:{
    show:true
  },
  a2ui: true,
  data: getChartData(),
  theme: isDark.value ? 'hdesign-dark' : 'hdesign-light'
}

const opt = properties?.option as any
if(opt as any){
  if(opt?.title?.path){
    let title = resolveValue(opt.title);
    opt.title = title;
  }
  if (opt?.title?.text && opt) {
    let title = opt.title;
    if (title?.text?.path) {
        title.text = resolveValue(title?.text) || {}
    }
    if (title?.subtext?.path) {
        title.subtext = resolveValue(title?.subtext) || {}
    }
    opt.title = title;
  }
}

if ((opt as any)?.color?.path) {
  (opt as any).color = resolveValue((opt as any).color) || []
}

function renderChart() {
    if (!chartRef.value) return
    const opt = properties?.option as any
    const chartIns = new HuiCharts()
    chartIns.init(chartRef.value,{renderer: 'svg'});
    chartIns.setSimpleOption(type, { ...(opt as any), ...defOption }, {})
    chartIns.render()
}

watch(isDark, (newValue) => {
  defOption.theme = newValue? 'hdesign-dark' : 'hdesign-light';
  renderChart();
})

onMounted(() => {
  nextTick(() => {
    renderChart()
  })
})

</script>

<template>
    <div :class="type + ' chart ' + className" ref="chartRef"></div>
</template>