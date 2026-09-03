/**
 * CategoryInput → CategoryInput 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（字面量） | value | LiteralValue.useState(onChange) — 受控 |
 * | value（DataBinding） | value | ComputedValue.useState(onChange) — 受控 |
 * | categoryOptions（字面量） | categoryOptions | 同名透传（{text, value}[]） |
 * | categoryOptions（DataBinding） | categoryOptions | 保持 BindingValue 原样 |
 * | category（字面量） | category | 同名透传 |
 * | category（DataBinding） | category | 保持 BindingValue 原样 |
 * | placeholder（字面量） | placeholder | 同名透传 |
 * | placeholder（DataBinding） | placeholder | 保持 BindingValue 原样 |
 * | disabled | disabled | 同名透传 |
 * | inputPosition | inputPosition | 同名透传（left/right） |
 * | className | className | 直接透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

export function createCategoryInputMapping(pkg: string): MappingDef {
  return {
    tag: 'CategoryInput',
    import: `${pkg}/CategoryInput`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI CategoryInput 的 props 是封闭集合
      // (value/categoryOptions/category/placeholder/disabled/inputPosition/className)，
      // 不做兜底透传，避免把目标库不支持的 prop 漏出去。

      // ─── value（useState 受控，双形态） ───
      //   字面量 → Value.literal（初始值 hardcode）
      //   DataBinding → Value.computed + useState（初始值从 state.js 取，path 直传）
      if ('value' in props) {
        const val = props.value
        if (val && typeof val === 'object' && val.type === 'binding') {
          outputProps.value = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (rawValue) => rawValue ?? '',
          })
        } else {
          outputProps.value = Value.literal({
            value: val ?? '',
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── categoryOptions（双形态：字面量直传，DataBinding 保持 BindingValue 原样） ───
      if ('categoryOptions' in props) {
        outputProps.categoryOptions = props.categoryOptions
      }

      // ─── category（双形态：字面量直传，DataBinding 保持 BindingValue 原样） ───
      if ('category' in props) {
        outputProps.category = props.category
      }

      // ─── placeholder（双形态：字面量直传，DataBinding 保持 BindingValue 原样） ───
      if ('placeholder' in props) {
        const ph = props.placeholder
        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          outputProps.placeholder = ph
        } else if (typeof ph === 'string') {
          outputProps.placeholder = ph
        }
      }

      // ─── disabled 透传 ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // ─── inputPosition 透传（left/right） ───
      if (props.inputPosition !== undefined) {
        outputProps.inputPosition = props.inputPosition
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
