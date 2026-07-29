/**
 * CollapseItem → PanelItem 映射（新架构）
 *
 * A2UI CollapseItem → eview-react PanelItem（named export from '@nce/eview-react/Panel'）。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | label（字面量） | title | 改名透传 |
 * | label（DataBinding） | title | 保持 BindingValue 原样 |
 * | key | — | 丢弃（由 children 顺序决定索引） |
 * | content（字面量） | children | 转为 TextNode 作为 children |
 * | content（DataBinding） | children | 转为 TextNode 含 BindingValue |
 * | content（SlotNode） | children | 展开 SlotNodeValue.node |
 * | extra | — | 丢弃（PanelItem 无对应 prop） |
 * | className | className | 透传 |
 *
 * ## 特殊逻辑
 *
 * - content 三分支全部转入 children，不在 props 上保留
 * - key 和 extra 丢弃
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Node } from '../../../src/core/node'

export function createCollapseItemMapping(pkg: string): MappingDef {
  return {
    tag: 'PanelItem',
    import: { source: `${pkg}/Panel`, named: true },

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      let children: any[] | null = null
      const SKIP_KEYS = new Set(['key', 'label', 'content', 'extra', 'className'])

      // ─── key → 丢弃 ───

      // ─── extra → 丢弃 ───

      // ─── label → title（双形态） ───
      if ('label' in props) {
        const label = props.label
        if (label && typeof label === 'object' && label.type === 'binding') {
          outputProps.title = label
        } else if (typeof label === 'string') {
          outputProps.title = label
        }
      }

      // ─── content → children（三分支，与 TabItem 一致） ───
      if ('content' in props) {
        const content = props.content
        if (typeof content === 'string') {
          children = [Node.text({ value: content })]
        } else if (content && typeof content === 'object' && content.type === 'slotNode') {
          children = [content.node]
        } else if (content && typeof content === 'object' && content.type === 'binding') {
          children = [Node.text({ value: content })]
        }
      }

      // ─── className 透传 ───
      if (props.className) outputProps.className = props.className

      // ─── 透传剩余 prop ───
      for (const [key, value] of Object.entries(props)) {
        if (!SKIP_KEYS.has(key)) {
          outputProps[key] = value as PropValue
        }
      }

      return {
        props: outputProps,
        children: children ?? undefined,
      }
    },
  }
}
