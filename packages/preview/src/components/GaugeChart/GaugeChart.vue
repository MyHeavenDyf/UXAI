<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from "vue"

import type { A2UIComponentProps, AnyComponentNode } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import HuiCharts from "@hui/charts"
import "./GaugeChart.less"

const props = defineProps<A2UIComponentProps<AnyComponentNode>>()
const { node, surfaceId } = props
const properties = props.node.properties
const type = props.node.type
const className = properties.className || ''
const chartRef = ref<HTMLElement | null>(null)
const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)

const getChartData = () => {
  let data = properties.option?.data || []
  if (properties.option?.data?.path) {
    data = resolveValue(properties.option?.data) || []
  }
  return data
}

if (properties.option?.color?.path) {
  properties.option.color = resolveValue(properties.option.color) || []
}

const defOption = computed(() => {
  let baseOption: any = {
    a2ui: true,
    data: getChartData(),
  }

  if (properties?.option?.process) {
    baseOption = {
      ...baseOption,
      startAngle: 90,
      endAngle: -270,
      text: {
        formatter: (value: any) => {
          return "{value|" + value + "}{unit| %}"
        },
        formatterStyle: {
          unit: {
            padding: [10, 0, 0, 0],
          },
        },
      },
    }
  }

  return baseOption
})

function renderChart() {
  if (!chartRef.value) return
  const chartIns = new HuiCharts()
  chartIns.init(chartRef.value)
  chartIns.setSimpleOption(
    type,
    { ...properties.option, ...defOption.value },
    {}
  )
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
