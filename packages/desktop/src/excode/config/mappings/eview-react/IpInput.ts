/**
 * IPInput → IPInput 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（字面量） | value | LiteralValue.useState(onChange) — 受控 |
 * | value（DataBinding） | value | ComputedValue.useState(onChange) — 受控 |
 * | type | type | 同名透传（v4/v6/mac） |
 * | delimiter | delimiter | 同名透传 |
 * | disabled | disabled | 同名透传 |
 * | className | className + inputStyle | 宽度类(w-*)→inputStyle（内联样式），其余→className |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { splitWidthToStyle } from '../../../src/codegen/split-width-style'

export function createIpInputMapping(pkg: string): MappingDef {
  return {
    tag: 'IPInput',
    import: `${pkg}/IPInput`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI IpInput 的 props 是封闭集合
      // (value/type/disabled/delimiter/className)，不做兜底透传，
      // 避免把目标库不支持的 prop 漏出去。

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

      // ─── type 透传（v4/v6/mac） ───
      if (props.type !== undefined) {
        outputProps.type = props.type
      }

      // ─── delimiter 透传 ───
      if (props.delimiter !== undefined) {
        outputProps.delimiter = props.delimiter
      }

      // ─── disabled 透传 ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // ─── className: 拆分宽度类 → inputStyle（内联样式），其余 → className ───
      const { className: remainCn, widthStyle } = splitWidthToStyle(props.className)
      if (remainCn) {
        outputProps.className = remainCn
      }
      if (widthStyle) {
        outputProps.inputStyle = widthStyle as any
      }

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
