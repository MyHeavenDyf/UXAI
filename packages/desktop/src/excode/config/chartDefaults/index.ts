/**
 * chart-defaults — 所有图表默认 option 的统一导出入口
 *
 * 用法：
 *   import { getChartDefaults } from '../../config/chartDefaults'
 *   const defaults = getChartDefaults(chartName, userOption)
 */

import type { ChartDefaultFn } from './merge'
import { deepMerge, functionify, cleanUnderscoreKeys } from './merge'
import barChart from './barChart'
import lineChart from './lineChart'
import scatterChart from './scatterChart'
import pieChart from './pieChart'
import radarChart from './radarChart'
import gaugeChart from './gaugeChart'
import processChart from './processChart'
import bubbleChart from './bubbleChart'
import bulletChart from './bulletChart'
import funnelChart from './funnelChart'
import hillChart from './hillChart'
import jadeJueChart from './jadeJueChart'
import assembleBubbleChart from './assembleBubbleChart'
import circleProcessChart from './circleProcessChart'

// ─── 支持 yAxisTitle → yAxis.name 转换的图表 ───
export const SPECIAL_YAXIS = new Set([
  'BarChart',
  'LineChart',
  'ScatterChart',
  'BubbleChart',
  'BulletChart',
])

// ─── 注册表 ───

const defaultFnMap: Record<string, ChartDefaultFn | undefined> = {
  BarChart: barChart,
  LineChart: lineChart,
  ScatterChart: scatterChart,
  PieChart: pieChart,
  RadarChart: radarChart,
  GaugeChart: gaugeChart,
  ProcessChart: processChart,
  BubbleChart: bubbleChart,
  BulletChart: bulletChart,
  FunnelChart: funnelChart,
  HillChart: hillChart,
  JadeJueChart: jadeJueChart,
  AssembleBubbleChart: assembleBubbleChart,
  CircleProcessChart: circleProcessChart,
}

// ─── 统一入口 ───

/**
 * 生成并返回合并后的 option。
 *
 * 流程：
 *   1. 调用对应图表类型的默认 option 函数（若无注册函数则使用空对象）
 *   2. deepMerge(默认, 用户) — 用户属性优先
 *   3. 运行时函数 → RawExprValue
 *   4. 清洗 __ 前缀字段
 *
 * @param chartName  A2UI 组件名，如 'BarChart'
 * @param userOption 用户传入的 option 对象（可能含 BindingValue）
 * @returns 可直接放入 outputProps.option 的合并后值
 */
export function buildChartOption(
  chartName: string,
  userOption: Record<string, any>,
): Record<string, any> {
  // 1. 获取默认 option
  const fn = defaultFnMap[chartName]
  const defaultOpt: Record<string, any> = fn ? fn(userOption) : {}

  // 2. 深合并（用户优先）
  const merged = deepMerge({ ...defaultOpt }, userOption)

  // 3. 注入 a2: true + theme
  merged.a2 = true
  if (!merged.theme) merged.theme = 'hdesign-light'
  // 如果 data 是空数组或 undefined，避免 Chart 组件报错
  if (merged.data === undefined) merged.data = []

  // 4. 运行时函数 → RawExprValue
  functionify(merged)

  // 5. 清洗 __ 前缀
  return cleanUnderscoreKeys(merged)
}
