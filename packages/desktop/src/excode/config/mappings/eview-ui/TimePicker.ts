/**
 * eview-ui TimePicker 映射（bespoke）
 *
 * 与 eview-react TimePicker 的差异：
 *   - format 直接透传（eview-ui 原生用 `hh` 小写，与 A2UI antd 规范一致，
 *     不做 eview-react 的 HH→hh 转换）
 *   - placeholder 映射（eview-ui 支持，eview-react 不支持→丢弃）
 *   - className 宽度类拆分目标为 style（eview-ui 有 style prop，
 *     eview-react 用 timeStyle）
 *
 * | A2UI prop | eview-ui prop | 处理方式 |
 * |-----------|--------------|---------|
 * | value（字面量 string） | time | LiteralValue.useState(onChange)，parseTimeString 转 [时,分,秒] |
 * | value（DataBinding） | time | ComputedValue.useState(onChange)，transform 字符串→数组 |
 * | format（antd 规范） | format | **直接透传**（eview-ui 用 `hh` 小写，与 A2UI 一致，不转换） |
 * | disabled（boolean/DataBinding） | disabled | 同名透传 |
 * | placeholder（string） | placeholder | 透传（eview-ui 支持） |
 * | placeholder（array） | placeholder | 取首项 |
 * | placeholder（DataBinding） | placeholder | ComputedValue（数组→首项） |
 * | className | className + style | 宽度类(w-*)→style(内联样式)，其余→className |
 * | secondStep/minuteStep/hourStep/range/size | — | 丢弃 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { splitWidthToStyle } from '../../../src/codegen/split-width-style'

/**
 * 将 "14:30:00" → [14, 30, 0]
 */
function parseTimeString(val: string): number[] | null {
  if (!val || typeof val !== 'string') return null
  const parts = val.split(':').map(Number)
  if (parts.length < 2 || parts.some(isNaN)) return null
  // 补全到 [h, m, s]，秒缺省为 0
  return [parts[0], parts[1], parts[2] ?? 0]
}

const TimePickerMapping: MappingDef = {
  tag: 'TimePicker',
  import: '@cloudsop/eview-ui/TimePicker',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}

    // 显性处理每个 A2UI prop（TimePicker: value/placeholder/secondStep/minuteStep/hourStep/range/size/format/disabled/className），不做兜底透传。

    // ─── value → time（useState 受控，双形态） ───
    if ('value' in props) {
      const val = props.value
      if (val && typeof val === 'object' && val.type === 'binding') {
        // DataBinding → ComputedValue + useState
        outputProps.time = Value.computed({
          path: val.path,
          pathType: val.pathType ?? 'absolute',
          accessPath: val.accessPath ?? 'timeValue',
          containsJSX: false,
          useState: {
            event: 'onChange',
            extractor: (setter) => `(time) => ${setter}(time)`,
          },
          transform: (rawValue: any) => {
            if (Array.isArray(rawValue)) return rawValue
            if (typeof rawValue === 'string') return parseTimeString(rawValue) ?? [0, 0, 0]
            return [0, 0, 0]
          },
        })
      } else {
        // 字面量 → LiteralValue + useState
        const timeArr = typeof val === 'string'
          ? parseTimeString(val)
          : (Array.isArray(val) ? val : [0, 0, 0])
        outputProps.time = Value.literal({
          value: timeArr ?? [0, 0, 0],
          useState: {
            event: 'onChange',
            extractor: (setter) => `(time) => ${setter}(time)`,
          },
        })
      }
    }

    // ─── format：直接透传（eview-ui 原生用 `hh` 小写，与 A2UI antd 规范一致，不转换） ───
    if (props.format !== undefined) {
      outputProps.format = props.format as PropValue
    }

    // ─── placeholder（eview-ui 支持，与 eview-react 丢弃不同） ───
    if ('placeholder' in props) {
      const ph = props.placeholder
      if (ph && typeof ph === 'object' && ph.type === 'binding') {
        // DataBinding → ComputedValue（数组→首项）
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

    // ─── disabled 透传（schema 为 boolean/DataBinding；只改名，字面量与 BindingValue 均直接赋值） ───
    if (props.disabled !== undefined) {
      outputProps.disabled = props.disabled
    }

    // ─── className: 拆分宽度类 → style（内联样式），其余 → className ───
    const { className: remainCn, widthStyle } = splitWidthToStyle(props.className)
    if (remainCn) {
      outputProps.className = remainCn
    }
    if (widthStyle) {
      outputProps.style = widthStyle as any
    }

    // ─── secondStep/minuteStep/hourStep/range/size 丢弃（eview-ui TimePicker 无对应概念） ───

    // 不做剩余兜底透传：A2UI TimePicker 的 props 已逐项显性处理。

    return {
      props: outputProps,
      children: null,
    }
  },
}

export default TimePickerMapping
