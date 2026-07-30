/**
 * DatePicker → DatePicker 映射（新架构）
 *
 * A2UI DatePicker 对应 eview-react 的 DatePicker 组件。
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（DataBinding，非 range） | value | ComputedValue.useState（受控），event: onChange |
 * | value（字面量 string，非 range） | value | LiteralValue.useState（受控），event: onChange |
 * | value（DataBinding，range 模式） | range | ComputedValue.useState（受控），event: onChange |
 * | value（字面量 array，range 模式） | range | LiteralValue.useState（受控），event: onChange |
 * | placeholder（DataBinding） | placeholder | ComputedValue（数组→首项） |
 * | placeholder（string/array） | placeholder | 数组取首项后透传 |
 * | picker | type | 同名透传（date→date, month→month 等） |
 * | range（literal true） | — | 作为模式开关消费，不直接透传；值由 value→range 映射 |
 * | range（DataBinding） | — | 丢弃（无法静态决定模式） |
 * | size | — | 丢弃（eview 无对应 prop） |
 * | format（moment 风格） | format（Java 风格） | 格式转换 YYYY→yyyy, DD→dd |
 * | className | className | 同名透传 |
 *
 * ## 注意事项
 *
 * - range 模式：A2UI range=true + value（数组）→ eview range prop；A2UI range 是 boolean 开关，eview range 是值本身
 * - format：A2UI 使用 moment 风格（YYYY-MM-DD），eview 使用 Java 风格（yyyy-MM-dd），需格式转换
 * - placeholder：range 模式下 A2UI 传数组，eview 只接受 string，取首项
 * - size（large/medium/small）：eview 无对应 prop，丢弃
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 格式转换：moment 风格 → Java 风格 ───

function convertFormat(fmt: string): string {
  // YYYY → yyyy（必须优先于 YY，否则 YYYY 变成 yyyy 后残留 YY→yy 会错）
  // DD → dd
  return fmt
    .replace(/YYYY/g, 'yyyy')
    .replace(/YY/g, 'yy')
    .replace(/DD/g, 'dd')
}

// ─── DatePicker 映射定义 ───

export function createDatePickerMapping(pkg: string): MappingDef {
  return {
    tag: 'DatePicker',
    import: `${pkg}/DatePicker`,

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

      // ─── size — 丢弃（eview 无对应 prop） ───

      // ─── format（moment 风格 → Java 风格） ───
      if (props.format && typeof props.format === 'string') {
        outputProps.format = convertFormat(props.format)
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
