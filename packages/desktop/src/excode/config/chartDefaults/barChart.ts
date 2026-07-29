/**
 * BarChart 默认 option
 */
export default function getBarDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [32, 2, 0, 2],
    theme: iChartOpt.theme,
    adaptive: true,
    datazoom: {
      left: 0,
    },
    tooltip: {
      show: true,
    },
    legend: {
      show: true,
      top: 2,
      right: 6,
      left: 'auto',
    },
    yAxis: {
      splitNumber: 4,
      name: iChartOpt.yAxisTitle || '',
    },
    xAxis: {
      fullGrid: true,
      axisLabel: {
        interval: 'auto',
        alignMinLabel: 'left',
        alignMaxLabel: 'right',
      },
    },
  }

  if (iChartOpt.direction === 'horizontal') {
    defOption.yAxis.axisLabel = {
      alignMaxLabel: 'right',
    }
  }

  return defOption
}
