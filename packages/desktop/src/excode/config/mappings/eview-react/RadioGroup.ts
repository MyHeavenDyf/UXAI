/**
 * RadioGroup → RadioGroup 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控） |
 * | value（字面量） | value | LiteralValue.useState（受控） |
 * | options（DataBinding） | data | ComputedValue + 字段重命名 label→text |
 * | options（字面量） | data | 字段重命名 label→text，简单值展开 |
 * | orientation | type | 同名透传（horizontal/vertical） |
 * | size | — | 丢弃 |
 * | — | isControlled | defaults: true（需受控模式） |
 * | className | className | 同名透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

// ─── 选项数据转换（label→text + 简单值展开） ───
function normalizeOptions(items: any[]): any[] {
  return items.map((item: any) => {
    if (typeof item !== 'object' || item === null) {
      return { text: String(item), value: item }
    }
    const result: any = { ...item }
    result.text = item.text ?? item.label
    delete result.label
    return result
  })
}

// ─── RadioGroup → RadioGroup 映射定义 ───

export function createRadioGroupMapping(pkg: string): MappingDef {
  return {
    tag: 'RadioGroup',
    import: `${pkg}/RadioGroup`,
    defaults: {
      isControlled: true,
    },

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI RadioGroup 的 props 是封闭集合
      // (value/options/orientation/size/className)，不做兜底透传。

      // ─── value → value（useState 受控） ───
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
              extractor: (setter) => `(oldVal, val) => ${setter}(val)`,
            },
            transform: (raw) => raw ?? '',
          })
        } else {
          // 字面量 → LiteralValue + useState
          outputProps.value = Value.literal({
            value: val ?? '',
            useState: {
              event: 'onChange',
              extractor: (setter) => `(oldVal, val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── options → data（字段重命名 label→text） ───
      if ('options' in props) {
        const opts = props.options
        if (opts && typeof opts === 'object' && opts.type === 'binding') {
          outputProps.data = Value.computed({
            path: opts.path,
            pathType: opts.pathType ?? 'absolute',
            accessPath: opts.accessPath,
            containsJSX: false,
            transform: (rawItems) => {
              const itemsArray = Array.isArray(rawItems) ? rawItems : []
              return normalizeOptions(itemsArray)
            },
          })
        } else if (Array.isArray(opts)) {
          outputProps.data = normalizeOptions(opts)
        }
      }

      // ─── orientation → type ───
      if (props.orientation) {
        outputProps.type = props.orientation
      }

      // ─── size 丢弃 ───

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // 不做剩余兜底透传：A2UI RadioGroup 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
