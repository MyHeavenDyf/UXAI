/**
 * Checkbox → Checkbox 映射
 *
 * A2UI 单选框 → eview-react Checkbox 组件。
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | checked（boolean/DataBinding） | checked | 同名透传 + useState（受控组件） |
 * | label（string/DataBinding） | label | 同名透传 |
 * | disabled | disabled | 同名透传 |
 * | className | className | 同名透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── Checkbox 映射定义 ───

export function createCheckboxMapping(pkg: string): MappingDef {
  return {
    tag: 'Checkbox',
    import: `${pkg}/Checkbox`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set(['checked', 'label', 'disabled', 'className'])

      // ─── checked → checked（双形态 + useState） ───
      if ('checked' in props) {
        const val = props.checked

        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding → ComputedValue + useState
          outputProps.checked = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (rawValue) => !!rawValue,
          })
        } else {
          // 字面量 → Value.literal + useState
          outputProps.checked = Value.literal({
            value: !!val,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── label 透传 ───
      if ('label' in props) {
        outputProps.label = props.label
      }

      // ─── disabled 透传 ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // ─── 剩余 prop 透传 ───
      for (const [key, value] of Object.entries(props)) {
        if (!SKIP_KEYS.has(key)) {
          outputProps[key] = value as PropValue
        }
      }

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
