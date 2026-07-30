/**
 * eview-ui DatePicker 映射（bespoke）
 *
 * 与 eview-react DatePicker 的差异：eview-ui 的 `format` 使用 moment.js 风格（与 A2UI 一致），
 * 直接透传，**不做** eview-react 那套 moment→Java 的格式转换（YYYY→yyyy / DD→dd）。
 * 其余 prop 处理与 eview-react 一致。
 *
 * | A2UI prop | eview-ui prop | 处理 |
 * |-----------|--------------|------|
 * | value（DataBinding，非 range） | value | ComputedValue.useState（受控），event: onChange |
 * | value（字面量 string，非 range） | value | LiteralValue.useState（受控），event: onChange |
 * | value（DataBinding，range 模式） | range | ComputedValue.useState（受控），event: onChange |
 * | value（字面量 array，range 模式） | range | LiteralValue.useState（受控），event: onChange |
 * | placeholder（DataBinding） | placeholder | ComputedValue（数组→首项） |
 * | placeholder（string/array） | placeholder | 数组取首项后透传 |
 * | picker | type | 同名透传 |
 * | range（literal true） | — | 作为模式开关消费；值由 value→range 映射 |
 * | range（DataBinding） | — | 丢弃（无法静态决定模式） |
 * | size | — | 丢弃 |
 * | format（moment 风格） | format | **直接透传**（eview-ui 用 moment 风格，与 A2UI 一致） |
 * | className | className | 同名透传 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

const DatePickerMapping: MappingDef = {
  tag: 'DatePicker',
  import: '@cloudsop/eview-ui/DatePicker',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}
    const SKIP_KEYS = new Set([
      'value',
      'placeholder',
      'picker',
      'range',
      'size',
      'format',
      'className',
    ])

    // ─── range 模式判定 ───
    // 只处理 literal true 的 range；DataBinding 无法静态决定模式，回退为非 range
    const isRangeMode = props.range === true

    // ─── value → value（非 range）/ range（range 模式），useState 受控 ───
    if ('value' in props) {
      const val = props.value
      const targetProp = isRangeMode ? 'range' : 'value'

      if (val && typeof val === 'object' && val.type === 'binding') {
        // DataBinding → ComputedValue + useState
        outputProps[targetProp] = Value.computed({
          path: val.path,
          pathType: val.pathType ?? 'absolute',
          accessPath: val.accessPath,
          containsJSX: false,
          useState: {
            event: 'onChange',
            extractor: (setter) => `(dateString) => ${setter}(dateString)`,
          },
          transform: (raw) => {
            if (isRangeMode) {
              return Array.isArray(raw) ? raw : [raw]
            }
            return raw ?? ''
          },
        })
      } else {
        // 字面量 → LiteralValue + useState
        outputProps[targetProp] = Value.literal({
          value: isRangeMode ? (Array.isArray(val) ? val : []) : (val ?? ''),
          useState: {
            event: 'onChange',
            extractor: (setter) => `(dateString) => ${setter}(dateString)`,
          },
        })
      }
    }

    // ─── placeholder（DataBinding/string/array → string） ───
    if ('placeholder' in props) {
      const ph = props.placeholder
      if (ph && typeof ph === 'object' && ph.type === 'binding') {
        outputProps.placeholder = Value.computed({
          path: ph.path,
          pathType: ph.pathType ?? 'absolute',
          accessPath: ph.accessPath,
          containsJSX: false,
          transform: (raw) => {
            if (Array.isArray(raw)) return String(raw[0] ?? '')
            return String(raw ?? '')
          },
        })
      } else if (Array.isArray(ph)) {
        outputProps.placeholder = String(ph[0] ?? '')
      } else if (typeof ph === 'string') {
        outputProps.placeholder = ph
      }
    }

    // ─── picker → type（同名透传） ───
    if (props.picker) {
      outputProps.type = props.picker
    }

    // ─── range（literal true）— 已消费为模式切换，不直接透传 ───
    // DataBinding range 丢弃（无合适的目标 prop）

    // ─── size — 丢弃 ───

    // ─── format：直接透传（eview-ui 用 moment 风格，与 A2UI 一致，不转换） ───
    if (props.format !== undefined) {
      outputProps.format = props.format as PropValue
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

export default DatePickerMapping
