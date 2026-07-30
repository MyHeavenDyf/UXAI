/**
 * TimePicker → TimePicker 映射（新架构）
 *
 * A2UI TimePicker → eview-react TimePicker 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | value（字面量 string） | time | **LiteralValue.useState** + 字符串→[时,分,秒] 转换 |
 * | value（DataBinding） | time | **ComputedValue.useState** + 编译期转换 |
 * | format（antd 规范） | format | antd HH→eview-react hh 转换 |
 * | className | className | 透传 |
 * | — | onChange | 由 useState.event 自动生成 |
 *
 * ## 特殊逻辑
 *
 * - value 双形态分叉：字面量→LiteralValue，DataBinding→ComputedValue
 * - A2UI value 是 "HH:mm:ss" 字符串，eview-react time 是 [时,分,秒] 数组
 * - format 需做 antd→eview-react 转换：HH→hh, mm→mm, ss→ss
 * - placeholder/secondStep/minuteStep/hourStep/range/size 丢弃
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

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

/**
 * antd format → eview-react format
 * HH:mm:ss → hh:mm:ss
 */
function convertFormat(fmt: string): string {
  if (!fmt || typeof fmt !== 'string') return fmt
  return fmt
    .replace(/HH/g, 'hh')
}

export function createTimePickerMapping(pkg: string): MappingDef {
  return {
    tag: 'TimePicker',
    import: `${pkg}/TimePicker`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set([
        'value', 'placeholder', 'secondStep', 'minuteStep', 'hourStep', 'range', 'size',
      ])

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

      // ─── format（antd→eview-react 转换）───
      if (props.format) {
        outputProps.format = convertFormat(props.format) as PropValue
      }

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
