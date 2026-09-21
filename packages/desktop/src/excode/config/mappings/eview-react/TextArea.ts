/**
 * TextArea → TextArea 映射（新架构）
 *
 * A2UI TextArea → eview-react TextArea 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | value（字面量） | value | **LiteralValue.useState** 受控 |
 * | value（DataBinding） | value | **ComputedValue.useState** 受控 |
 * | placeholder | placeholder | 透传 |
 * | maxLength | maxLength | 透传 |
 * | autoSize | sizeAuto | 改名透传 |
 * | size | — | 丢弃 |
 * | className | className + inputStyle | 宽度类(w-*)→inputStyle(内联样式)，其余→className |
 * | — | onChange | 由 useState.event 自动生成 |
 *
 * ## 特殊逻辑
 *
 * - value 双形态分叉：字面量→LiteralValue，DataBinding→ComputedValue
 * - 均触发生成 useState + onChange 事件
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { splitWidthToStyle } from '../../../src/codegen/split-width-style'

export function createTextAreaMapping(pkg: string): MappingDef {
  return {
    tag: 'TextArea',
    import: `${pkg}/TextArea`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI TextArea 的 props 是封闭集合
      // (value/placeholder/size/maxLength/autoSize/className)，不做兜底透传，
      // 避免 width 拆分类被原始 className 覆盖回外层。

      // ─── value（useState 受控，双形态） ───
      if ('value' in props) {
        const val = props.value
        if (val && typeof val === 'object' && val.type === 'binding') {
          outputProps.value = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath ?? 'textAreaValue',
            containsJSX: false,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (rawValue: any) => rawValue ?? '',
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

      // ─── placeholder ───
      if (props.placeholder !== undefined) outputProps.placeholder = props.placeholder

      // ─── maxLength ───
      if (props.maxLength !== undefined) outputProps.maxLength = props.maxLength

      // ─── autoSize → sizeAuto ───
      if (props.autoSize !== undefined) outputProps.sizeAuto = props.autoSize

      // ─── size 丢弃（eview-react TextArea 无 size 概念） ───

      // ─── className: 拆分宽度类 → inputStyle（内联样式），其余 → className ───
      const { className: remainCn, widthStyle } = splitWidthToStyle(props.className)
      if (remainCn) {
        outputProps.className = remainCn
      }
      if (widthStyle) {
        outputProps.inputStyle = widthStyle as any
      }

      // 不做剩余兜底透传：A2UI TextArea 的 props 已逐项显性处理。
      // （原先兜底循环会用原始 props.className 覆盖上面 splitWidthToStyle 的拆分结果，
      //   导致宽度类被回写进外层 className，已移除。）

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
