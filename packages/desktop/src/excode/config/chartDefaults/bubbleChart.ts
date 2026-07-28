/**
 * BubbleChart 默认 option
 */
export default function getBubbleDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [32, 2, 0, 2],
    theme: iChartOpt.theme,
    adaptive: true,
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
      axisLabel: {
        interval: 'auto',
        alignMaxLabel: 'right',
      },
    },
  }

  return defOption
}
