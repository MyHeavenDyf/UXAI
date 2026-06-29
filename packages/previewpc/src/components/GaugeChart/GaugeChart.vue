<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from "vue"

import type { A2UIComponentProps, AnyComponentNode } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import { useTheme } from "../../composables/useTheme";
import HuiCharts from "@hui/charts"
import "./GaugeChart.less"

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

if ((properties.option as any)?.color?.path) {
  (properties.option as any).color = resolveValue((properties.option as any).color) || []
}

const defOption = computed(() => {
  let baseOption: any = {
    a2ui: true,
    data: getChartData(),
    theme: isDark.value ? 'hdesign-dark' : 'hdesign-light'
  }

  if ((properties?.option as any)?.process) {
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
    { ...(properties.option as any), ...defOption.value },
    {}
  )
  chartIns.render()
}

watch(isDark, (newValue) => {
  defOption.value.theme = newValue? 'hdesign-dark' : 'hdesign-light';
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
