/**
 * AssembleBubbleChart 默认 option
 */
export default function getAssembleBubbleDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [2, 2, 2, 2],
    theme: iChartOpt.theme,
    adaptive: true,
    legend: {
      show: true,
      position: {
        left: 'center',
        bottom: 2,
      },
    },
  }

  return defOption
}
