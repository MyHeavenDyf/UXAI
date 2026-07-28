/**
 * HillChart 默认 option（山丘图）
 */
export default function getHillDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [32, 2, 0, 2],
    theme: iChartOpt.theme,
    adaptive: true,
    opacity: 0.8,
    text: {
      fontSize: '12',
      show: true,
    },
    coincide: '0%',
    yAxisName: 'Units',
    axis: {
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
    },
    xAxis: {
      axisLabel: {
        interval: 'auto',
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
