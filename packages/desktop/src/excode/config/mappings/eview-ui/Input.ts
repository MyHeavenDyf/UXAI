/**
 * Input → TextField 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value | value | LiteralValue.useState（受控） |
 * | placeholder | placeholder | 同名透传 |
 * | size | — | 丢弃 |
 * | maxLength | maxLength | 同名透传 |
 * | prefix | — | 丢弃（eview-ui TextField 无 prefix prop，仅支持 suffix） |
 * | suffix | suffix | 占位 URL（写死，见 [icon-placeholder](./icon-placeholder)）；eview-ui icon 只接 URL、不接 React DOM |
 * | password: true | type: 'password' | boolean → string |
 * | className | className + inputStyle | 宽度类(w-*)→inputStyle(内联样式)，其余→className |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 *
 * ⚠️ eview-ui 本地副本：与 eview-react 差异在 icon——eview-ui 的 icon 相关属性只接
 * URL 字符串、不接 React DOM，故 suffix 一律用统一占位 URL（写死），不再 resolveIcon。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { splitWidthToStyle } from '../../../src/codegen/split-width-style'
import { PLACEHOLDER_ICON_URL } from './icon-placeholder'

// ─── Input → TextField 映射定义 ───

export function createInputMapping(pkg: string): MappingDef {
  return {
    tag: 'TextField',
    import: `${pkg}/TextField`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Input 的 props 是封闭集合
      // (value/placeholder/size/maxLength/prefix/suffix/password/className)，
      // 不再做"非 SKIP 即透传"的兜底，避免把目标库不支持的 prop 漏出去。

      // ─── value → value（useState 受控，双形态） ───
      //   字面量 → Value.literal（初始值 hardcode）
      //   DataBinding → Value.computed + useState（初始值从 state.js 取，path 直传，无需 resolveValueFromPath）
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

      // ─── placeholder（双形态：字面量直传，DataBinding 保持 BindingValue 原样） ───
      if ('placeholder' in props) {
        const ph = props.placeholder
        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          // 只改名不改值：保持 BindingValue，管线自动 emit 为 state 引用
          outputProps.placeholder = ph
        } else if (typeof ph === 'string') {
          outputProps.placeholder = ph
        }
      }

      // ─── size 丢弃 ───

      // ─── maxLength 透传 ───
      if (props.maxLength !== undefined) {
        outputProps.maxLength = props.maxLength
      }

      // ─── prefix/suffix icon ───
      //   eview-ui TextField 无 prefix prop（仅 suffix）；suffix 一律用统一占位 URL
      //   （写死，不管输入是字面量还是 DataBinding——eview-ui icon 只接 URL）。
      if (props.suffix) {
        outputProps.suffix = PLACEHOLDER_ICON_URL
      }

      // ─── password → type ───
      if (props.password === true) {
        outputProps.type = 'password'
      }

      // ─── className: 拆分宽度类 → inputStyle（内联样式），其余 → className ───
      // TextField 的 className 控制外层容器，inputStyle 控制内部 input 元素；
      // 宽度类（w-47, w-[226px] 等）应作用于 input 元素，故拆到 inputStyle。
      // 内联 style 优先级高于 CSS class，无需 !important。
      const { className: remainCn, widthStyle } = splitWidthToStyle(props.className)
      if (remainCn) {
        outputProps.className = remainCn
      }
      if (widthStyle) {
        outputProps.inputStyle = widthStyle as any
      }

      // 不做剩余兜底透传：A2UI Input 的 props 已逐项显性处理，
      // 避免把目标库不支持的 prop（如 prefix/size）漏传给 TextField。

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
