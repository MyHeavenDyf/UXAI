<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue"

import type { A2UIComponentProps, AnyComponentNode } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { useTheme } from "../../composables/useTheme";
import HuiCharts from "@hui/charts"
import "./CircleProcessChart.less"

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const type = props.node.type
const className = properties.className || ''
const chartRef = ref<HTMLElement | null>(null)
const { resolveValue } = useA2UIComponent(node, surfaceId)

if((properties.option as any)?.path) {
  properties.option = resolveValue(properties.option as any)
}

const { isDark } = useTheme();

const getChartData = () => {
  const opt = properties.option as any
  let data = opt?.data ||  [{ "value": 50, "name": "value" }];
  if(opt?.data && !opt?.data?.path) {

    data.forEach((item: any) => {
      if(item?.value?.path) {
        item.value = resolveValue(item.value) || ''
      }
      if(item?.name?.path) {
        item.name = resolveValue(item.name) || ''
      }
    })
    
  }
  if (opt?.data?.path) {
    data = resolveValue(opt?.data) || [{ "value": 50, "name": "value" }];
  }
  
  return data
}

if ((properties.option as any)?.color?.path) {
  (properties.option as any).color = resolveValue((properties.option as any).color) || []
}

if ((properties.option as any)?.title) {

  let title = (properties.option as any).title;
  if (title?.text?.path) {
    title.text = resolveValue(title?.text) || {}
  }
  if (title?.subtext?.path) {
    title.subtext = resolveValue(title?.subtext) || {}
  }
  (properties.option as any).title = title;
}

const defOption =  {
    a2ui: true,
    data: getChartData(),
    theme: isDark.value ? 'hdesign-dark' : 'hdesign-light'
}

function renderChart() {
  if (!chartRef.value) return
  const chartIns = new HuiCharts()
  chartIns.init(chartRef.value)
  const opt = properties.option as any
  if(opt?.title) {
    if(opt?.title?.textStyle) {
      delete opt?.title?.textStyle;
    }
    if(opt?.title?.subtextStyle) {
      delete opt?.title?.subtextStyle;
    }
  }
  chartIns.setSimpleOption(
    type,
    { ...opt, ...defOption },
    {}
  )
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
