/**
 * eview-ui TextArea 映射（bespoke）
 *
 * 与 eview-react TextArea 的差异：eview-ui TextArea **不支持** `sizeAuto` prop，
 * 故 A2UI 的 `autoSize` 在 eview-ui 下**丢弃**（eview-react 是改名透传 `autoSize→sizeAuto`）。
 * value 受控、placeholder、maxLength、size 丢弃、className 等其余逻辑与 eview-react 一致。
 *
 * | A2UI prop | eview-ui prop | 处理方式 |
 * |-----------|--------------|---------|
 * | value（字面量） | value | LiteralValue.useState 受控 |
 * | value（DataBinding） | value | ComputedValue.useState 受控 |
 * | placeholder | placeholder | 透传 |
 * | maxLength | maxLength | 透传 |
 * | autoSize | — | **丢弃**（eview-ui 无 sizeAuto） |
 * | size | — | 丢弃 |
 * | className | className | 透传 |
 * | — | onChange | 由 useState.event 自动生成 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

const TextAreaMapping: MappingDef = {
  tag: 'TextArea',
  import: '@cloudsop/eview-ui/TextArea',

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

    // ─── autoSize — 丢弃（eview-ui 无 sizeAuto） ───

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

export default TextAreaMapping
