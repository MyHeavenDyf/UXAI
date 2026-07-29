/**
 * InputNumber → Spinner 映射（新架构）
 *
 * A2UI InputNumber → eview-react Spinner 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | value（字面量） | value | **LiteralValue.useState** 受控 |
 * | value（DataBinding） | value | **ComputedValue.useState** 受控 |
 * | min | min | 透传 |
 * | max | max | 透传 |
 * | step | step | 透传 |
 * | controls | — | 丢弃（Spinner 始终有按钮） |
 * | size | — | 丢弃 |
 * | placeholder | — | 丢弃 |
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

export function createInputNumberMapping(pkg: string): MappingDef {
  return {
    tag: 'Spinner',
    import: `${pkg}/Spinner`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set(['value', 'placeholder', 'controls', 'size'])

      // ─── value → value（useState 受控，双形态） ───
      if ('value' in props) {
        const val = props.value
        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding → ComputedValue + useState
          outputProps.value = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath ?? 'spinnerValue',
            containsJSX: false,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (rawValue: any) => {
              if (rawValue === null || rawValue === undefined) return 0
              return typeof rawValue === 'number' ? rawValue : Number(rawValue)
            },
          })
        } else {
          // 字面量 → LiteralValue + useState
          const literalVal = val ?? 0
          outputProps.value = Value.literal({
            value: literalVal,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── min 透传 ───
      if (props.min !== undefined) outputProps.min = props.min

      // ─── max 透传 ───
      if (props.max !== undefined) outputProps.max = props.max

      // ─── step 透传 ───
      if (props.step !== undefined) outputProps.step = props.step

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
