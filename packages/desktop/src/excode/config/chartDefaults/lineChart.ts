/**
 * LineChart 默认 option
 */
export default function getLineDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const dataLen = Array.isArray(iChartOpt.data) && iChartOpt.data.length > 0
    ? Object.keys(iChartOpt.data[0]).length
    : 0
  const defArea = dataLen < 5 ? true : false

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
      fullGrid: true,
      axisLabel: {
        interval: 'auto',
        alignMinLabel: 'left',
        alignMaxLabel: 'right',
      },
    },
    area: iChartOpt.area !== undefined ? iChartOpt.area : defArea,
  }

  return defOption
}
