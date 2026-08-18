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
 * | disabled（boolean/DataBinding） | disabled | 同名透传（只改名不改值，字面量与 BindingValue 均直接赋值） |
 * | closable（boolean/DataBinding） | closable | 同名透传（同上；A2UI schema 字段，由 TabItem 自身声明） |
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
 * - disabled / closable：schema 为 boolean/DataBinding，同名不改值 → 直接赋值（字面量与 BindingValue 均透传，TabItem 自行处理，不由 Tabs 改写）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { Node } from '../../../src/core/node-factory'

export function createTabItemMapping(pkg: string): MappingDef {
  return {
    tag: 'TabItem',
    import: { source: `${pkg}/Tab`, named: true },

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      let children: any[] | null = null

      // 显性处理每个 A2UI prop：A2UI TabItem 的 props 是封闭集合
      // (key/label/icon/disabled/closable/content)，不做兜底透传。

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

      // ─── disabled 透传（schema 为 boolean/DataBinding；只改名，字面量与 BindingValue 均直接赋值） ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // ─── closable 透传（A2UI schema 字段，由 TabItem 自身声明；eview-react TabItem 支持。只改名，字面量与 BindingValue 均直接赋值） ───
      if (props.closable !== undefined) {
        outputProps.closable = props.closable
      }

      // 不做剩余兜底透传：A2UI TabItem 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: children ?? undefined,
      }
    },
  }
}
