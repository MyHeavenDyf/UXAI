/**
 * 图表组件统一映射（新架构）
 *
 * A2UI 所有标准图表组件 → eview-react Chart 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | component | name | 透传 A2UI 组件名作为图表类型标识 |
 * | option（字面量） | option | 与默认 option 深合并 + a2:true + theme |
 * | option.data（{path} 绑定） | option.data | 管线自动转 BindingValue，保持引用 |
 * | option.color（{path} 绑定） | option.color | 管线自动转 BindingValue，保持引用 |
 * | option.yAxisTitle | option.yAxis.name | 仅 Bar/Line/Scatter/Bubble/BulletChart，透传 rename |
 * | className | className | 透传 |
 * | id | id | 透传 |
 * | — | option.a2 | 固定注入 `true` |
 * | — | option.theme | 默认 `'hdesign-light'` |
 * | children | — | 吞噬（图表组件不支持 children） |
 *
 * ## 特殊逻辑
 *
 * - 统一使用 Chart 组件，通过 `name` prop 区分图表类型
 * - BuildTrees 已递归处理 option 内嵌的 {path} 绑定→BindingValue，transform 不额外处理
 * - 默认 option 从 chartDefaults/ 加载 + 深合并
 * - 运行时函数（formatter 等）自动转为 RawExprValue 序列化
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { buildChartOption, SPECIAL_YAXIS } from '../../chartDefaults'

export function createChartMapping(pkg: string): MappingDef {
  return {
    tag: 'Chart',
    import: `${pkg}/Chart`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const chartName = node.component as string

      // ─── 读取 A2UI option ───
      const a2uiOption = props.option ? { ...(props.option as Record<string, any>) } : {}

      // ─── yAxisTitle → yAxis.name（仅 SPECIAL_YAXIS 中的图表）───
      if (SPECIAL_YAXIS.has(chartName) && a2uiOption.yAxisTitle !== undefined) {
        const title = a2uiOption.yAxisTitle
        delete a2uiOption.yAxisTitle
        // 如果用户已定义 yAxis，合并 name 进去；否则新建 yAxis
        if (a2uiOption.yAxis) {
          a2uiOption.yAxis = { ...a2uiOption.yAxis, name: title }
        } else {
          a2uiOption.yAxis = { name: title }
        }
      }

      // ─── 构建最终 option（合并默认 + 注入 a2/theme）───
      const mergedOption = buildChartOption(chartName, a2uiOption)

      // ─── 构造输出 props ───
      const outputProps: Record<string, PropValue> = {
        name: chartName,
        option: mergedOption as PropValue,
      }

      // 透传 className
      if (props.className) {
        outputProps.className = props.className
      }

      // 透传 id
      if (props.id) {
        outputProps.id = props.id
      }

      return {
        props: outputProps,
        children: null,
        selfClosing: true,
      }
    },
  }
}
