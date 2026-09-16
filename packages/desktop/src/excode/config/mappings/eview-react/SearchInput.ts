/**
 * SearchInput → SearchInput 映射
 *
 * | A2UI prop | eview prop | 处理 |
 * |-----------|-----------|------|
 * | value | value | LiteralValue/ComputedValue.useState(onChange) 受控双形态 |
 * | placeholder | placeholder | 字面量透传 / DataBinding 保留原 BindingValue |
 * | disabled | disabled | 同名透传 |
 * | popItems | popItems | DataBinding(path)→ComputedValue(containsJSX:false)；字面量数组原样透传；item 形状 {text,value,disabled?} 与 eview 一致 |
 * | className | className + inputStyle | 宽度类(w-xx)→inputStyle(内联)，其余→className（同 Input） |
 *
 * 无 icon 属性 → eview-ui 直接复用本工厂（无本地副本）。
 * A2UI 未声明 onSearch/onSuggest 等事件 → 不接，仅 useState 受控回写 value。
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { splitWidthToStyle } from '../../../src/codegen/split-width-style'

export function createSearchInputMapping(pkg: string): MappingDef {
  return {
    tag: 'SearchInput',
    import: `${pkg}/SearchInput`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // ─── value → value（useState 受控，双形态；onChange=(value)=>void，value-first extractor） ───
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
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (rawValue) => rawValue ?? '',
          })
        } else {
          outputProps.value = Value.literal({
            value: val ?? '',
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── placeholder（双形态：字面量透传，DataBinding 保留原 BindingValue） ───
      if ('placeholder' in props) {
        const ph = props.placeholder
        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          outputProps.placeholder = ph
        } else if (typeof ph === 'string') {
          outputProps.placeholder = ph
        }
      }

      // ─── disabled 透传 ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // ─── popItems（DataBinding path→ComputedValue；字面量数组透传；item 形状与 eview 一致，无需重命名） ───
      // 同 Select.options：DataBinding 走 ComputedValue(containsJSX:false)，transform 防御性兜空数组
      if ('popItems' in props) {
        const items = props.popItems
        if (items && typeof items === 'object' && items.type === 'binding') {
          outputProps.popItems = Value.computed({
            path: items.path,
            pathType: items.pathType ?? 'absolute',
            accessPath: items.accessPath,
            containsJSX: false,
            transform: (rawItems) => (Array.isArray(rawItems) ? rawItems : []),
          })
        } else if (Array.isArray(items)) {
          outputProps.popItems = items as any
        }
      }

      // ─── className: 拆分宽度类 → inputStyle，其余 → className（同 Input） ───
      const { className: remainCn, widthStyle } = splitWidthToStyle(props.className)
      if (remainCn) {
        outputProps.className = remainCn
      }
      if (widthStyle) {
        outputProps.inputStyle = widthStyle as any
      }

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
