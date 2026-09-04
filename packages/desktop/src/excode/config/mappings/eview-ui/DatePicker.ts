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
 * | value（DataBinding，range 模式） | value | ComputedValue.useState（受控），event: onChange；tag 切换为 DatePicker.RangePicker |
 * | value（字面量 array，range 模式） | value | LiteralValue.useState（受控），event: onChange；tag 切换为 DatePicker.RangePicker |
 * | placeholder（DataBinding，非 range） | placeholder | ComputedValue（数组→首项） |
 * | placeholder（string/array，非 range） | placeholder | 数组取首项后透传 |
 * | placeholder（DataBinding，range 模式） | placeholder | ComputedValue（保持数组） |
 * | placeholder（string/array，range 模式） | placeholder | 保持数组形式 |
 * | picker | type | 同名透传 |
 * | range（literal true） | — | 作为模式开关消费；tag→DatePicker.RangePicker |
 * | range（DataBinding） | — | 丢弃（无法静态决定模式） |
 * | size | — | 丢弃 |
 * | format（moment 风格） | format | **直接透传**（eview-ui 用 moment 风格，与 A2UI 一致） |
 * | className | className | 同名透传 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

const DatePickerMapping: MappingDef = {
  tag: 'DatePicker',
  import: '@cloudsop/eview-ui/DatePicker',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}

    // 显性处理每个 A2UI prop（DatePicker: value/placeholder/picker/range/size/format/className），不做兜底透传。

    // ─── range 模式判定 ───
    // 只处理 literal true 的 range；DataBinding 无法静态决定模式，回退为非 range
    const isRangeMode = props.range === true

    // ─── range 模式 → DatePicker.RangePicker ───
    if (isRangeMode) {
      // value → value（RangePicker 用 value prop）
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
              extractor: (setter) => `(dateString) => ${setter}(dateString)`,
            },
            transform: (raw) => Array.isArray(raw) ? raw : [raw],
          })
        } else {
          outputProps.value = Value.literal({
            value: Array.isArray(val) ? val : [],
            useState: {
              event: 'onChange',
              extractor: (setter) => `(dateString) => ${setter}(dateString)`,
            },
          })
        }
      }

      // placeholder → 数组形式（RangePicker 需要数组占位符）
      if ('placeholder' in props) {
        const ph = props.placeholder
        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          outputProps.placeholder = Value.computed({
            path: ph.path,
            pathType: ph.pathType ?? 'absolute',
            accessPath: ph.accessPath,
            containsJSX: false,
            transform: (raw) => Array.isArray(raw) ? raw : [raw],
          })
        } else if (Array.isArray(ph)) {
          outputProps.placeholder = ph
        } else if (typeof ph === 'string') {
          outputProps.placeholder = [ph, ph]
        }
      }
      // A2UI 未提供 placeholder 时不设默认

      // picker → type（同名透传）
      if (props.picker) {
        outputProps.type = props.picker
      }

      // format：直接透传（eview-ui 用 moment 风格，与 A2UI 一致，不转换）
      if (props.format !== undefined) {
        outputProps.format = props.format as PropValue
      }

      // className 透传
      if (props.className) {
        outputProps.className = props.className
      }

      return {
        tag: 'DatePicker.RangePicker',
        props: outputProps,
        children: null,
        selfClosing: true,
      }
    }

    // ─── 非 range 模式 ───

    // ─── value → value，useState 受控 ───
    if ('value' in props) {
      const val = props.value
      if (val && typeof val === 'object' && val.type === 'binding') {
        // DataBinding → ComputedValue + useState
        outputProps.value = Value.computed({
          path: val.path,
          pathType: val.pathType ?? 'absolute',
          accessPath: val.accessPath,
          containsJSX: false,
          useState: {
            event: 'onChange',
            extractor: (setter) => `(dateString) => ${setter}(dateString)`,
          },
          transform: (raw) => raw ?? '',
        })
      } else {
        // 字面量 → LiteralValue + useState
        outputProps.value = Value.literal({
          value: val ?? '',
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

    // 不做剩余兜底透传：A2UI DatePicker 的 props 已逐项显性处理。

    return {
      props: outputProps,
      children: null,
    }
  },
}

export default DatePickerMapping
