/**
 * CircleProcessChart 默认 option
 */
export default function getCircleProcessDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [20, 0, 10, 0],
    theme: iChartOpt.theme,
    adaptive: true,
    legend: {
      show: false,
    },
  }

  return defOption
}
