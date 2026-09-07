/**
 * GaugeChart 默认 option
 */
export default function getGaugeDefOpt(_iChartOpt: Record<string, any>): Record<string, any> {
  const defOption: Record<string, any> = {
    padding: [20, 0, 10, 1],
    theme: _iChartOpt.theme,
    itemStyle: {
      outerGauge: {
        show: false,
      },
    },
    legend: {
      show: false,
    },
    position: {
      center: ['50%', '50%'],
      radius: '65%',
    },
    adaptive: true,
  }

  return defOption
}
