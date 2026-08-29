/**
 * Chart 公共组件（eview-ui shared）
 *
 * eview-ui 无 Chart 组件，此处手动实现对齐 eview-react Chart 接口，内部用 @hui/charts（HuiCharts）渲染。
 * 映射层（api/config/mappings/eview-react/Chart.ts 工厂，eview-ui 复用）产出的 props：
 *   - name：图表类型字符串（LineChart / BarChart / PieChart / GaugeChart / RadarChart / ProcessChart / BubbleChart …）
 *     —— 即 A2UI 图表组件名，直接作为 HuiCharts 的 chartType
 *   - option：图表配置对象（含 a2:true、theme、数据等，由 buildChartOption 构建）
 *   - className / id
 *
 * HuiCharts 用法：
 *   const ins = new HuiCharts()
 *   ins.init(containerDom)
 *   ins.setSimpleOption(chartType, option)
 *   ins.render()
 *
 * import: import Chart from '@/shared/Chart'
 */

import React, { useEffect, useRef } from 'react'
// @ts-ignore — @hui/charts 来自 tgz，无类型声明
import HuiCharts from '@hui/charts'

export interface ChartProps {
  /** 图表类型（A2UI 图表组件名，作为 HuiCharts chartType） */
  name: string
  /** 图表配置对象 */
  option: Record<string, any>
  className?: string
  id?: string
  style?: React.CSSProperties
}

export default function Chart(props: ChartProps) {
  const { name, option, className, id, style } = props
  const containerRef = useRef<HTMLDivElement>(null)
  // HuiCharts 实例（无类型声明，用 any）
  const chartRef = useRef<any>(null)

  // 挂载：创建实例 + init（仅一次）
  useEffect(() => {
    const dom = containerRef.current
    if (!dom) return
    const ins = new HuiCharts()
    ins.init(dom)
    chartRef.current = ins
    return () => {
      // 卸载：释放（若库支持 dispose）
      const cur = chartRef.current
      if (cur) {
        try {
          cur.dispose?.()
        } catch {
          // ignore
        }
      }
      chartRef.current = null
    }
  }, [])

  // name / option 变化（含初始）：setSimpleOption + render
  useEffect(() => {
    const ins = chartRef.current
    if (!ins) return
    ins.setSimpleOption(name, option)
    ins.render()
  }, [name, option])

  return (
    <div
      id={id}
      className={className}
      ref={containerRef}
      // 图表容器需要明确尺寸：默认宽度 100%、高度 300px，可被 style/className 覆盖
      style={{ width: '100%', height: 300, ...style }}
    />
  )
}
