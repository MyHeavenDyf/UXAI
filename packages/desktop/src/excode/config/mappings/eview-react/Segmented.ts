/**
 * Segmented → SelectCard 映射
 *
 * A2UI Segmented 对应 eview-react 的 SelectCard 组件。
 *
 * | A2UI prop | SelectCard prop | 处理 |
 * |-----------|----------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控） |
 * | value（字面量） | value | LiteralValue.useState（受控） |
 * | options | data | 字段重命名 label→text，简单值→{text, value}；icon 丢弃（SelectCard 无 icon） |
 * | size | type | small→'small'，medium/large→'default' |
 * | orientation | — | 丢弃（SelectCard 仅 horizontal） |
 * | block | — | 丢弃 |
 * | className | className | 同名透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 选项数据转换（label→text + 简单值展开） ───

function normalizeOptions(items: any[]): any[] {
  return items.map((item: any) => {
    // 简单 string/number → { text, value }
    if (typeof item !== 'object' || item === null) {
      return { text: String(item), value: item }
    }
    const result: any = { ...item }
    // label → text（SelectCard 使用 text 字段）
    if (item.label !== undefined) {
      result.text = item.text ?? item.label
      delete result.label
    }
    // icon 丢弃（SelectCard ItemType 无 icon）
    delete result.icon
    return result
  })
}

// ─── size → type 值映射 ───
const SIZE_TO_TYPE: Record<string, string> = {
  small: 'small',
  medium: 'default',
  large: 'default',
}

// ─── Segmented → SelectCard 映射定义 ───

export function createSegmentedMapping(pkg: string): MappingDef {
  return {
    tag: 'SelectCard',
    import: `${pkg}/SelectCard`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set(['value', 'options', 'orientation', 'block', 'size', 'className'])

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
            transform: (raw) => raw ?? '',
          })
        } else {
          // 字面量 → LiteralValue + useState
          outputProps.value = Value.literal({
            value: val ?? '',
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── options → data（字段重命名 label→text，icon 丢弃） ───
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
              return itemsArray.map((item: any) => {
                if (typeof item !== 'object' || item === null) {
                  return { text: String(item), value: item }
                }
                const result: any = { ...item }
                if (item.label !== undefined) {
                  result.text = item.text ?? item.label
                  delete result.label
                }
                delete result.icon
                return result
              })
            },
          })
        } else if (Array.isArray(opts)) {
          outputProps.data = normalizeOptions(opts)
        }
      }

      // ─── orientation / block — 丢弃 ───

      // ─── size → type（small→small, medium/large→default） ───
      if (props.size && typeof props.size === 'string') {
        outputProps.type = SIZE_TO_TYPE[props.size] ?? 'default'
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
