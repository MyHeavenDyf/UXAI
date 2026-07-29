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
 * | className | className | 透传 |
 * | — | onChange | 由 useState.event 自动生成 |
 *
 * ## 特殊逻辑
 *
 * - value 双形态分叉：字面量→LiteralValue，DataBinding→ComputedValue
 * - 均触发生成 useState + onChange 事件
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

export function createTextAreaMapping(pkg: string): MappingDef {
  return {
    tag: 'TextArea',
    import: `${pkg}/TextArea`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set(['value', 'placeholder', 'maxLength', 'autoSize', 'size'])

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

      // ─── className ───
      if (props.className) outputProps.className = props.className as PropValue

      // 透传剩余
      for (const [key, value] of Object.entries(props)) {
        if (!SKIP_KEYS.has(key)) outputProps[key] = value as PropValue
      }

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
