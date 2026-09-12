/**
 * Select → Select / MultipleSelect 映射（新架构）
 *
 * A2UI Select 对应 eview-react 的 Select（单选）、InputSelect（单选+搜索）或 MultipleSelect（多选）组件。
 * 通过 A2UI `mode: "multiple"` 与 `showSearch` 共同决定路由到哪个目标组件：
 *   - mode="multiple"               → MultipleSelect
 *   - 单选 + showSearch 为真         → InputSelect（带模糊搜索的输入+下拉组合件）
 *   - 单选 + 无 showSearch            → Select
 *
 * ## Select（单选）Props 对照
 *
 * | A2UI prop | eview Select prop | 处理 |
 * |-----------|------------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控），event: onChange |
 * | value（字面量） | value | LiteralValue.useState（受控），event: onChange |
 * | options（DataBinding） | options | ComputedValue + label→text |
 * | options（字面量） | options | label→text 转换 |
 * | placeholder | defaultLabel | 改名透传 |
 * | size | — | 丢弃 |
 * | showSearch | — | 丢弃（Select 无搜索 prop） |
 * | className | className + selectStyle | 宽度类(w-*)→selectStyle(内联样式)，其余→className |
 *
 * ## MultipleSelect（多选）Props 对照
 *
 * | A2UI prop | eview MultipleSelect prop | 处理 |
 * |-----------|--------------------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控），event: onChange |
 * | value（字面量数组） | value | LiteralValue.useState（受控），event: onChange |
 * | options（DataBinding） | options | ComputedValue + label→text |
 * | options（字面量） | options | label→text 转换 |
 * | placeholder | placeholder | 同名透传 |
 * | showSearch | searchable | 改名透传 |
 * | size | — | 丢弃 |
 * | className | className + inputStyle | 宽度类(w-*)→inputStyle(内联样式)，其余→className |
 *
 * ## InputSelect（单选+搜索）Props 对照
 *
 * | A2UI prop | eview InputSelect prop | 处理 |
 * |-----------|-----------------------|------|
 * | value（DataBinding） | value | ComputedValue.useState，event: onChange（**空占位、不回写 setter**） |
 * | value（字面量） | value | LiteralValue.useState，event: onChange（空占位） |
 * | options（DataBinding） | options | ComputedValue + label→text |
 * | options（字面量） | options | label→text 转换 |
 * | placeholder | placeholder | 同名透传（InputSelect 占位 prop 即 placeholder，非 defaultLabel） |
 * | showSearch | — | 作为路由信号消费，不透传（InputSelect 搜索内置） |
 * | size | — | 丢弃 |
 * | className | className + selectStyle | 宽度类(w-*)→selectStyle(内联样式)，其余→className |
 *
 * ## 注意事项
 *
 * - tag 动态路由：mode="multiple" → MultipleSelect；单选+showSearch 为真 → InputSelect；否则 Select
 * - options：A2UI { label, value } → eview { text, value }
 * - placeholder 在不同目标组件中 prop 名不同：Select 用 defaultLabel；MultipleSelect / InputSelect 用 placeholder
 * - size（large/medium/small）：三个目标组件均无对应 prop，丢弃
 * - InputSelect 的 onChange 为空占位 `(value) => {}`，不回写 state（单向只读绑定）；其余分支 onChange 回写 setter
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（含 MultipleSelect / InputSelect 分支），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { splitWidthToStyle } from '../../../src/codegen/split-width-style'

// ─── 选项数据转换（label→text + 简单值展开） ───

function normalizeOptions(items: any[]): any[] {
  return items.map((item: any) => {
    if (typeof item !== 'object' || item === null) {
      return { text: String(item), value: item }
    }
    const result: any = { ...item }
    // label → text
    if (item.label !== undefined) {
      result.text = item.text ?? item.label
      delete result.label
    }
    return result
  })
}

// ─── Select 映射定义 ───

export function createSelectMapping(pkg: string): MappingDef {
  return {
    tag: 'Select',
    import: `${pkg}/Select`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Select 的 props 是封闭集合
      // (value/options/size/placeholder/showSearch/mode/className)，不做兜底透传。

      // ─── 路由判定 ───
      // mode="multiple"               → MultipleSelect
      // 单选 + showSearch 为真         → InputSelect（带模糊搜索的输入+下拉组合件）
      // 单选 + 无 showSearch            → Select
      const isMultiple = props.mode === 'multiple'
      const isInputSelect = !isMultiple && !!props.showSearch

      // ─── 动态 tag / import ───
      // 多选 → MultipleSelect；单选+搜索 → InputSelect；否则沿用 MappingDef（Select）
      let overrideTag: string | undefined
      let overrideImport: string | undefined
      if (isMultiple) {
        overrideTag = 'MultipleSelect'
        overrideImport = `${pkg}/MultipleSelect`
      } else if (isInputSelect) {
        overrideTag = 'InputSelect'
        overrideImport = `${pkg}/InputSelect`
      }

      // InputSelect 分支：onChange 为空占位（不回写 setter），单参 value
      // 其余分支：onChange 回写 setter
      const valueExtractor = isInputSelect
        ? (_setter: string) => '(value) => {}'
        : (setter: string) => `(val) => ${setter}(val)`

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
              extractor: valueExtractor,
            },
            transform: (raw) => raw ?? (isMultiple ? [] : ''),
          })
        } else {
          // 字面量 → LiteralValue + useState
          outputProps.value = Value.literal({
            value: val ?? (isMultiple ? [] : ''),
            useState: {
              event: 'onChange',
              extractor: valueExtractor,
            },
          })
        }
      }

      // ─── options → options（字段重命名 label→text） ───
      if ('options' in props) {
        const opts = props.options
        if (opts && typeof opts === 'object' && opts.type === 'binding') {
          outputProps.options = Value.computed({
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
          outputProps.options = normalizeOptions(opts)
        }
      }

      // ─── placeholder → defaultLabel（Select）/ placeholder（MultipleSelect、InputSelect）───
      if ('placeholder' in props) {
        const ph = props.placeholder
        const targetPlaceholderKey = (isMultiple || isInputSelect) ? 'placeholder' : 'defaultLabel'

        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          // DataBinding 形态一般不改名（placeholder→placeholder），但 Select 要改
          // 对于 Select，BindingValue 原样透传给 defaultLabel 即可（只改名不改值）
          // 对于 MultipleSelect / InputSelect，placeholder 同名，BindingValue 原样透传
          outputProps[targetPlaceholderKey] = ph as PropValue
        } else if (typeof ph === 'string') {
          outputProps[targetPlaceholderKey] = ph
        }
      }

      // ─── showSearch → searchable（仅 MultipleSelect） ───
      // InputSelect 分支：showSearch 是路由信号，消费后不透传（InputSelect 搜索内置）
      // 纯单选 Select：showSearch 丢弃
      if (isMultiple && props.showSearch !== undefined) {
        outputProps.searchable = props.showSearch
      }

      // ─── size — 丢弃（eview 无对应 prop） ───

      // ─── className: 拆分宽度类 → style prop（内联样式），其余 → className ───
      // Select / InputSelect 的宽度类 → selectStyle；MultipleSelect 的宽度类 → inputStyle
      const { className: remainCn, widthStyle } = splitWidthToStyle(props.className)
      if (remainCn) {
        outputProps.className = remainCn
      }
      if (widthStyle) {
        const styleKey = isMultiple ? 'inputStyle' : 'selectStyle'
        outputProps[styleKey] = widthStyle as any
      }

      // 不做剩余兜底透传：A2UI Select 的 props 已逐项显性处理。

      return {
        tag: overrideTag,
        import: overrideImport,
        props: outputProps,
        children: null,
      }
    },
  }
}
