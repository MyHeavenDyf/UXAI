/**
 * CheckboxGroup → CheckboxGroup 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控） |
 * | value（字面量数组） | value | LiteralValue.useState（受控） |
 * | options（DataBinding） | data | ComputedValue + 字段重命名 label→text |
 * | options（字面量） | data | 字段重命名 label→text，简单值展开 |
 * | disabled（boolean/DataBinding） | disabled | 同名透传（只改名不改值，BindingValue 直接赋值） |
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

// ─── CheckboxGroup → CheckboxGroup 映射定义 ───

export function createCheckboxGroupMapping(pkg: string): MappingDef {
  return {
    tag: 'CheckboxGroup',
    import: `${pkg}/CheckboxGroup`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI CheckboxGroup 的 props 是封闭集合
      // (value/options/disabled/className)，不做兜底透传。

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
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (raw) => (Array.isArray(raw) ? raw : []),
          })
        } else {
          // 字面量 → LiteralValue + useState
          outputProps.value = Value.literal({
            value: Array.isArray(val) ? val : [],
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
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

      // ─── disabled 透传（schema 为 boolean / DataBinding；只改名，字面量与 BindingValue 均直接赋值） ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // 不做剩余兜底透传：A2UI CheckboxGroup 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
