<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'

import type { A2UIComponentProps, AnyComponentNode } from '../../renderer'
import { useA2UIComponent } from '../../renderer/render/hooks'
import HuiCharts from '@hui/charts'
import './PieChart.less'
import { title } from 'process'

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
  legend:{
    show:true,
    formatter: (name) => {
      let item = defOption.data.filter((item) => item.name === name)[0];
      return '{title|' + name + '}{value|' + item.value + 'GB}'
    }
  },
  a2ui: true,
  data: getChartData(),
}



if (properties.option.title?.text) {
  let title = properties.option.title;
  if (title?.text?.path) {
      title.text = resolveValue(title?.text) || {}
  }
  if (title?.subtext?.path) {
      title.subtext = resolveValue(title?.subtext) || {}
  }
  properties.option.title = title;
  // 不存在text则设置为饼图
} else {
   properties.option.type = 'pie'
}
// 不存在title则设置为饼图
if(!properties.option.title) {
   properties.option.type = 'pie'
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