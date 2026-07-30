/**
 * Breadcrumb → Crumbs 映射（新架构）
 *
 * A2UI Breadcrumb 对应 eview-react 的 Crumbs 组件。
 *
 * | A2UI prop | Crumbs prop | 处理 |
 * |-----------|------------|------|
 * | items（DataBinding） | data | ComputedValue（过滤 type 项 + 删专用字段） |
 * | items（字面量数组） | data | 过滤 type 项 + 删专用字段后透传 |
 * | separator（DataBinding） | seprator | BindingValue 原样透传（只改名） |
 * | separator（字面量 string） | seprator | 改名透传 |
 * | className | className | 同名透传 |
 *
 * ## items 数据项转换
 *
 * ```
 * A2UI Item { title, type?, separator? }  →  Crumbs ICrumb { title }
 * ```
 * - type="reference" / type="separator" 项过滤丢弃（A2UI 专用，Crumbs 无此概念）
 * - title 原样保留（支持 string / DataBinding / SlotNode）
 * - 删除 A2UI 专用字段 type、separator
 *
 * ## 注意事项
 *
 * - Crumbs 的 `seprator` prop 名含拼写变体（文档如此），非笔误
 * - separator 为全局分隔符，A2UI items 中每个 item 的独立 separator 不保留
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 面包屑单项归一化 ───

/**
 * 将 A2UI item 转为 Crumbs ICrumb。
 * - 过滤 type="reference"/"separator" 项（Crumbs 无此概念）
 * - 删除 A2UI 专用字段
 */
function normalizeCrumb(item: any): any {
  if (typeof item !== 'object' || item === null) return item
  // 跳过 A2UI 专用 type 项
  if (item.type === 'reference' || item.type === 'separator') return null
  const result: any = { ...item }
  // 删除 A2UI 专用字段（Crumbs 不识别）
  delete result.type
  delete result.separator
  return result
}

// ─── Breadcrumb → Crumbs 映射定义 ───

export function createBreadcrumbMapping(pkg: string): MappingDef {
  return {
    tag: 'Crumbs',
    import: `${pkg}/Crumbs`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set(['items', 'separator', 'className'])

      // ─── items → data（过滤 + 归一化） ───
      if ('items' in props) {
        const items = props.items
        if (items && typeof items === 'object' && items.type === 'binding') {
          // DataBinding → ComputedValue
          outputProps.data = Value.computed({
            path: items.path,
            pathType: items.pathType ?? 'absolute',
            accessPath: items.accessPath,
            containsJSX: false,
            transform: (rawItems) => {
              const arr = Array.isArray(rawItems) ? rawItems : []
              return arr.map(normalizeCrumb).filter(Boolean)
            },
          })
        } else if (Array.isArray(items)) {
          // 字面量 → 直接转换
          outputProps.data = items
            .map(normalizeCrumb)
            .filter(Boolean) as PropValue
        }
      }

      // ─── separator → seprator（改名透传） ───
      if ('separator' in props) {
        const sep = props.separator
        if (sep && typeof sep === 'object' && sep.type === 'binding') {
          // DataBinding → BindingValue 原样透传（只改名）
          outputProps.seprator = sep as PropValue
        } else if (typeof sep === 'string') {
          outputProps.seprator = sep
        }
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
