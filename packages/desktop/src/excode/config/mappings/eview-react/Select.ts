/**
 * Select → Select / MultipleSelect 映射（新架构）
 *
 * A2UI Select 对应 eview-react 的 Select（单选）或 MultipleSelect（多选）组件。
 * 通过 A2UI `mode: "multiple"` 决定路由到哪个目标组件。
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
 * | className | className | 同名透传 |
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
 * | className | className | 同名透传 |
 *
 * ## 注意事项
 *
 * - tag 动态路由：mode="multiple" → MultipleSelect，否则 Select
 * - options：A2UI { label, value } → eview { text, value }
 * - placeholder 在不同目标组件中 prop 名不同（Select: defaultLabel，MultipleSelect: placeholder）
 * - size（large/medium/small）：两个目标组件均无对应 prop，丢弃
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（含 MultipleSelect 分支），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

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
      const SKIP_KEYS = new Set([
        'value',
        'options',
        'placeholder',
        'size',
        'showSearch',
        'mode',
        'className',
      ])

      // ─── mode 判定 ───
      // mode="multiple" → 路由到 MultipleSelect，否则 Select
      const isMultiple = props.mode === 'multiple'

      // ─── 动态 tag / import ───
      // 多选时覆盖目标组件
      let overrideTag: string | undefined
      let overrideImport: string | undefined
      if (isMultiple) {
        overrideTag = 'MultipleSelect'
        overrideImport = `${pkg}/MultipleSelect`
      }

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
            transform: (raw) => raw ?? (isMultiple ? [] : ''),
          })
        } else {
          // 字面量 → LiteralValue + useState
          outputProps.value = Value.literal({
            value: val ?? (isMultiple ? [] : ''),
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
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

      // ─── placeholder → defaultLabel（Select）/ placeholder（MultipleSelect） ───
      if ('placeholder' in props) {
        const ph = props.placeholder
        const targetPlaceholderKey = isMultiple ? 'placeholder' : 'defaultLabel'

        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          // DataBinding 形态一般不改名（placeholder→placeholder），但 Select 要改
          // 对于 Select，BindingValue 原样透传给 defaultLabel 即可（只改名不改值）
          // 对于 MultipleSelect，placeholder 同名，BindingValue 原样透传
          outputProps[targetPlaceholderKey] = ph as PropValue
        } else if (typeof ph === 'string') {
          outputProps[targetPlaceholderKey] = ph
        }
      }

      // ─── showSearch → searchable（仅 MultipleSelect） ───
      if (isMultiple && props.showSearch !== undefined) {
        outputProps.searchable = props.showSearch
      }
      // 非多选时 showSearch 丢弃

      // ─── size — 丢弃（eview 无对应 prop） ───

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
        tag: overrideTag,
        import: overrideImport,
        props: outputProps,
        children: null,
      }
    },
  }
}
