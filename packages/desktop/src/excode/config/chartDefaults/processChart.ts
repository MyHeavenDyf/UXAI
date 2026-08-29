/**
 * ProcessChart 默认 option（进度条）
 */
export default function getProcessDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const getMaxValue = (data: any[]) => {
    if (data && data.length > 0) {
      return Math.max(...data.map((item: any) => item.value))
    }
  }
  const maxValue = getMaxValue(iChartOpt.data)
  const calibrationValue = (maxValue && maxValue > 100) ? { calibrationValue: maxValue } : {}

  const defOption: Record<string, any> = {
    padding: [12, 0, 0, 0],
    title: {
      fontSize: 12,
      position: [0, -14],
      color: '#777777',
    },
    text: {
      color: '#777777',
      fontSize: 12,
      offset: [0, -14],
    },
    theme: iChartOpt.theme,
    legend: {
      show: false,
    },
    adaptive: true,
    ...calibrationValue,
  }

  return defOption
}
