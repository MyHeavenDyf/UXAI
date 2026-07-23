/**
 * FunnelChart 默认 option
 */
export default function getFunnelDefOpt(iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [32, 2, 0, 2],
    theme: iChartOpt.theme,
    adaptive: true,
    label: {
      color: '#ffffff',
    },
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
