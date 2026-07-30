/**
 * TabItem → TabItem 映射（新架构）
 *
 * A2UI TabItem → eview-react TabItem（named export from '@nce/eview-react/Tab'）。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | label（字面量） | title | 改名透传 |
 * | label（DataBinding） | title | 保持 BindingValue 原样 |
 * | icon（字面量） | icon | ctx.resolveIcon() → BuildNode 直出 |
 * | icon（DataBinding） | icon | **ComputedValue** + containsJSX:true |
 * | key | — | 丢弃（由 children 顺序决定索引） |
 * | content（字面量） | children | 转为 TextNode 作为 children |
 * | content（DataBinding） | children | 转为 TextNode 含 BindingValue 作为 children |
 * | content（SlotNode） | children | 展开 SlotNodeValue.node 为 children |
 * | className | className | 透传 |
 *
 * ## 特殊逻辑
 *
 * - content 三分支全部转入 children，不在 props 上保留
 * - icon 双形态分叉：字面量直接 resolveIcon，DataBinding 走 ComputedValue
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'
import { Node } from '../../../src/core/node'

export function createTabItemMapping(pkg: string): MappingDef {
  return {
    tag: 'TabItem',
    import: { source: `${pkg}/Tab`, named: true },

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      let children: any[] | null = null
      const SKIP_KEYS = new Set(['key', 'label', 'icon', 'content', 'className'])

      // ─── key → 丢弃（由 children 顺序决定索引） ───

      // ─── label → title（双形态） ───
      if ('label' in props) {
        const label = props.label
        if (label && typeof label === 'object' && label.type === 'binding') {
          outputProps.title = label
        } else if (typeof label === 'string') {
          outputProps.title = label
        }
      }

      // ─── icon → icon（双形态） ───
      if ('icon' in props) {
        const icon = props.icon
        if (icon && typeof icon === 'object' && icon.type === 'binding') {
          // DataBinding → ComputedValue
          outputProps.icon = Value.computed({
            path: icon.path,
            pathType: icon.pathType ?? 'absolute',
            accessPath: icon.accessPath,
            containsJSX: true,
            transform: (rawValue, cvCtx) => {
              const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
              return typeof rawValue === 'string' ? rIcon(rawValue) : null
            },
          }) as any
        } else if (typeof icon === 'string') {
          // 字面量 → 直接 resolveIcon
          const iconNode = ctx.resolveIcon(icon)
          if (iconNode) {
            outputProps.icon = iconNode as any
          }
        }
      }

      // ─── content → children（三分支） ───
      if ('content' in props) {
        const content = props.content
        delete props.content // 确保不会透传

        if (typeof content === 'string') {
          // 分支 1：纯文本 → TextNode
          children = [Node.text({ value: content })]
        } else if (content && typeof content === 'object' && content.type === 'slotNode') {
          // 分支 2：SlotNode → 展开节点的 BuildNode 为 children
          children = [content.node]
        } else if (content && typeof content === 'object' && content.type === 'binding') {
          // 分支 3：DataBinding → TextNode 含 BindingValue
          children = [Node.text({ value: content })]
        }
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

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
