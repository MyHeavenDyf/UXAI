/**
 * Pagination → Paging 映射
 *
 * A2UI Pagination → eview-react Paging 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | current（字面量 number） | currentPage | 改名 + **LiteralValue.useState**（event: onPageChange） |
 * | current（DataBinding） | currentPage | **ComputedValue.useState**（path 透传，transform: Number(raw) \|\| 1） |
 * | total（字面量 number） | recordCount | 改名透传 |
 * | total（DataBinding） | recordCount | BindingValue 改名（只换 prop key，值不变） |
 * | showTotal | — | 丢弃（eview-react Paging 始终显示总条数，无对应 prop） |
 * | simple（字面量 true） | type: 'select' | 值映射（简化分页样式） |
 * | simple（字面量 false/未设） | type: 'list' | 默认（Paging 默认值，可省略） |
 * | simple（DataBinding） | type | **ComputedValue**（containsJSX: false，transform: boolean → 'select'/'list'） |
 * | className | className | 透传 |
 * | — | pageSize | 无 A2UI 对应；使用 Paging 默认值（10） |
 * | — | onPageChange | 由 useState.event 自动注入，不手动添加 |
 *
 * ## 特殊逻辑
 *
 * - current 无论字面量还是 DataBinding，都产生 useState（Paging 是受控组件）
 * - total → recordCount 仅改名，不产生 useState（recordCount 是只读数据源）
 * - showTotal 丢弃：eview-react Paging 始终显示总条数，无 toggle prop
 * - simple → type 是值映射：boolean → 'select'/'list' 字符串
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

export function createPaginationMapping(pkg: string): MappingDef {
  return {
    tag: 'Paging',
    import: `${pkg}/Paging`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Pagination 的 props 是封闭集合
      // (current/total/showTotal/simple/className)，不做兜底透传。

      // ─── current → currentPage（双形态 + useState 受控） ───
      // Paging 是受控组件，必须产生 useState
      //   字面量 → Value.literal（初始值为 hardcode）
      //   DataBinding → Value.computed + useState（初始值从 state.js 取值）
      if ('current' in props) {
        const val = props.current

        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding → ComputedValue + useState
          outputProps.currentPage = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            useState: {
              event: 'onPageChange',
              extractor: (setter) => `(page) => ${setter}(page)`,
            },
            transform: (rawValue) => Number(rawValue) || 1,
          })
        } else {
          // 字面量 → Value.literal + useState
          outputProps.currentPage = Value.literal({
            value: val ?? 1,
            useState: {
              event: 'onPageChange',
              extractor: (setter) => `(page) => ${setter}(page)`,
            },
          })
        }
      }

      // ─── total → recordCount（改名，无 useState） ───
      // recordCount 是只读数据源，Paging 不提供修改 recordCount 的事件
      if ('total' in props) {
        const val = props.total

        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding → BindingValue 改名（只换 prop key，值不变）
          outputProps.recordCount = Value.binding({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            stateValue: val.stateValue,
            nodeId: val.nodeId,
            componentName: val.componentName,
            propKey: val.propKey,
          })
        } else {
          // 字面量 → 直接赋值
          outputProps.recordCount = val
        }
      }

      // ─── showTotal — 丢弃（eview-react Paging 始终显示总条数，无 toggle prop） ───

      // ─── simple → type（值映射：boolean → 'select'/'list'） ───
      if ('simple' in props) {
        const val = props.simple

        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding → ComputedValue（boolean → 'select'/'list'）
          outputProps.type = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            transform: (rawValue) => !!rawValue ? 'select' : 'list',
          })
        } else {
          // 字面量 → 直接值映射
          if (val === true) {
            outputProps.type = 'select'
          }
          // simple=false 或其它 falsy：使用 Paging 默认值 'list'，不设置
        }
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // 不做剩余兜底透传：A2UI Pagination 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null,
        propRoute: { currentPage: 'component-internal' },
      }
    },
  }
}
