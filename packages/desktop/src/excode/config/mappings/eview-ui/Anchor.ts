/**
 * Anchor → Anchor 映射（eview-ui，数据式）
 *
 * 与 eview-react Anchor 的 **API 结构性不同**（故独立实现，不复用 eview-react 工厂）：
 *   - eview-react Anchor 是**组合式**（`<AnchorLink>` children），见 `../eview-react/Anchor.ts`；
 *   - eview-ui Anchor 是**数据式**：`<Anchor data={AnchorMenuItem[]} offset container />`，
 *     `AnchorMenuItem = { id, title, disabled, children }`。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-ui prop | 处理 |
 * |-----------|---------------|------|
 * | items（字面量） | data | normalizeAnchorItem 逐项：href→id（去 `#`）、丢 key/target、递归 children |
 * | items（DataBinding） | data | ComputedValue(containsJSX:false) + transform normalize（Breadcrumb 式） |
 * | offsetTop | offset | 改名透传（number） |
 * | container | container | 同名透传（CSS 选择器原样含 `#`） |
 * | className | className | 透传 |
 *
 * ## AnchorItem → AnchorMenuItem 字段
 *
 * A2UI AnchorItem = { key, href, title(string\|DataBinding\|SlotNode), target, children[] }。
 * - href（'#section-1'）→ id（'section-1'，去前导 `#`，eview-ui id 是 DOM id 不含 `#`）
 * - title → title（string\|ReactNode 原样；字面量分支 build-trees 已转 BindingValue/SlotNode）
 * - key → 丢弃（eview-ui AnchorMenuItem 无 key 字段，用 id）
 * - target → 丢弃（eview-ui AnchorMenuItem 无 target 字段）
 * - children → 递归 normalize（多级嵌套）
 * - disabled → A2UI schema 无，不设
 *
 * ## items→data 双形态
 *
 * - 字面量数组 → `items.map(normalizeAnchorItem)` 直传（plain array；title 内嵌的
 *   BindingValue/SlotNode 由 state-builder consumeValue 收集/emit，同 Breadcrumb normalizeCrumb）
 * - DataBinding → `Value.computed({containsJSX:false, transform})`：transform 期 rawData 已
 *   解析（绝对/相对路径同机制），逐项 normalize，防御性兜空数组
 *
 * 无 icon（AnchorItem 无 icon 字段）→ 不调 resolveIcon、不涉 eview-ui icon-URL 边界。
 * 无事件 / 无 active 状态（A2UI schema 无）→ 不接事件、不做 useState。
 *
 * 工厂化：接收目标组件库包名 `pkg`（= `@cloudsop/eview-ui`），构建 import 路径。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

// ─── 单项归一化：AnchorItem → AnchorMenuItem ───

/** 去前导 `#`：'#section-1' → 'section-1'；非字符串原样返回。 */
function stripHash(s: any): any {
  if (typeof s === 'string' && s.startsWith('#')) return s.slice(1)
  return s
}

/**
 * A2UI AnchorItem → eview-ui AnchorMenuItem。
 * - href → id（去 `#`）
 * - title 原样保留（string | BindingValue | SlotNode）
 * - key / target 丢弃（eview-ui 无此字段）
 * - children 递归 normalize（多级嵌套）
 */
function normalizeAnchorItem(item: any): any {
  if (typeof item !== 'object' || item === null) return item
  const out: any = { id: stripHash(item.href) }
  if (item.title !== undefined) out.title = item.title
  if (Array.isArray(item.children) && item.children.length > 0) {
    out.children = item.children.map(normalizeAnchorItem)
  }
  return out
}

// ─── eview-ui Anchor 映射定义 ───

export function createAnchorMapping(pkg: string): MappingDef {
  return {
    tag: 'Anchor',
    import: `${pkg}/Anchor`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Anchor 的 props 是封闭集合
      // (offsetTop/container/items/className)，不做兜底透传。

      // ─── items → data（normalize + 双形态） ───
      if ('items' in props) {
        const items = props.items
        if (items && typeof items === 'object' && items.type === 'binding') {
          // DataBinding → ComputedValue(containsJSX:false) + transform normalize
          outputProps.data = Value.computed({
            path: items.path,
            pathType: items.pathType ?? 'absolute',
            accessPath: items.accessPath ?? 'anchorItems',
            containsJSX: false,
            transform: (raw: any) =>
              Array.isArray(raw) ? raw.map(normalizeAnchorItem) : [],
          })
        } else if (Array.isArray(items)) {
          // 字面量 → normalize 数组直传
          outputProps.data = items.map(normalizeAnchorItem) as PropValue
        }
      }

      // ─── offsetTop → offset（改名透传） ───
      if (props.offsetTop !== undefined) {
        outputProps.offset = props.offsetTop as PropValue
      }

      // ─── container 同名透传 ───
      if (props.container !== undefined) {
        outputProps.container = props.container as PropValue
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className as PropValue
      }

      // 不做剩余兜底透传：A2UI Anchor 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
