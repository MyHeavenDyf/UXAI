/**
 * Slider → DragInput 映射（新架构）
 *
 * A2UI Slider 对应 eview-react 的 DragInput 组件。
 *
 * | A2UI prop | DragInput prop | 处理 |
 * |-----------|----------------|------|
 * | value（DataBinding，单值） | value | ComputedValue.useState + 包装为 [raw]（受控） |
 * | value（字面量 number，单值） | value | LiteralValue.useState + 包装为 [val]（受控） |
 * | value（DataBinding，range） | value | ComputedValue.useState 透传（已为数组）（受控） |
 * | value（字面量 array，range） | value | LiteralValue.useState（受控） |
 * | min | min | 同名透传 |
 * | max | max | 同名透传 |
 * | range（true/false） | type | 值映射：true→'range'，false/未设→'single' |
 * | orientation | — | 丢弃（DragInput 无对应 prop） |
 * | step | — | 丢弃 |
 * | input（boolean） | displayInput | 同名透传 + 覆盖默认（A2UI 默认不显示输入框） |
 * | marks（object） | markIndexes | 对象 key 提取为 number[] |
 * | className | className | 同名透传 |
 *
 * ## 注意事项
 *
 * - value 始终包装为数组：A2UI 单值为 number，DragInput 始终接收 number[]
 * - marks→markIndexes：A2UI 的 `{ "0": "0", "25": "25" }` 转为 `[0, 25, 50, ...]`
 * - input→displayInput：A2UI 未设时默认不显示，覆盖 eview 默认 true
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── marks 对象 → markIndexes 数组 ───

function marksToIndexes(marks: Record<string, any>): number[] {
  return Object.keys(marks)
    .map(Number)
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b)
}

// ─── Slider → DragInput 映射定义 ───

export function createSliderMapping(pkg: string): MappingDef {
  return {
    tag: 'DragInput',
    import: `${pkg}/DragInput`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set([
        'value',
        'min',
        'max',
        'range',
        'orientation',
        'step',
        'input',
        'marks',
        'className',
      ])

      // ─── range 模式判定 ───
      const isRangeMode = props.range === true
      outputProps.type = isRangeMode ? 'range' : 'single'

      // ─── value → value（useState 受控，始终包装为数组） ───
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
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (raw) => {
              if (Array.isArray(raw)) return raw
              return [raw ?? 0]
            },
          })
        } else {
          // 字面量 → LiteralValue + useState（始终转为数组）
          const arrayVal = Array.isArray(val) ? val : [val ?? 0]
          outputProps.value = Value.literal({
            value: arrayVal,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── min / max 透传 ───
      if (props.min !== undefined) {
        outputProps.min = props.min
      }
      if (props.max !== undefined) {
        outputProps.max = props.max
      }

      // ─── orientation — 丢弃 ───

      // ─── step — 丢弃 ───

      // ─── input → displayInput（覆盖 eview 默认 true） ───
      if ('input' in props) {
        outputProps.displayInput = props.input
      } else {
        outputProps.displayInput = false
      }

      // ─── marks（object）→ markIndexes（number[]） ───
      if (props.marks && typeof props.marks === 'object' && !Array.isArray(props.marks)) {
        outputProps.markIndexes = marksToIndexes(props.marks)
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
