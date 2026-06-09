<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue"

import type { A2UIComponentProps, AnyComponentNode } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import HuiCharts from "@hui/charts"
import "./LineChart.less"

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const type = props.node.type
const className = properties.className || ''
const chartRef = ref<HTMLElement | null>(null)
const { resolveValue } = useA2UIComponent(node, surfaceId)

const getChartData = () => {
  let data = properties.option?.data || []
  if (properties.option?.data?.path) {
    data = resolveValue(properties.option?.data) || []
  }
  return data
}

const defOption = {
  a2ui: true,
  data: getChartData(),
  yAxis: {
    name: properties.option?.yAxisTitle || ''
  },
  area: true
}

const itemData = defOption.data[0];

if(itemData && (Object.keys(itemData).length > 4)) {
  defOption.area = false;
}

if (properties.option?.color?.path) {
  properties.option.color = resolveValue(properties.option.color) || []
}

function renderChart() {
  if (!chartRef.value) return
  const chartIns = new HuiCharts()
  chartIns.init(chartRef.value)
  chartIns.setSimpleOption(type, { ...properties.option, ...defOption }, {})
  chartIns.render()
}

onMounted(() => {
  nextTick(() => {
    renderChart()
  })
})
</script>

<template>
  <div :class="type + ' chart ' + className" ref="chartRef"></div>
</template>
