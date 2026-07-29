/**
 * Timeline → TimeLine 映射（新架构）
 *
 * A2UI Timeline → eview-react TimeLine 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | orientation | — | 丢弃（eview-react 只支持垂直） |
 * | mode / variant | — | 丢弃 |
 * | className | className | 透传 |
 * | children（TimelineItem 列表） | data | **吞噬 children** → 转为 dataType[] |
 *
 * ## dataType 映射
 *
 * | A2UI TimelineItem prop | eview-react dataType | 处理方式 |
 * |------------------------|---------------------|---------|
 * | title（存的是日期字符串） | date | 改名透传 |
 * | content（字面量） | content | 包装为 `[{ text: xxx }]` 数组 |
 * | content（DataBinding） | content | 同上，每项 item[path] 映射 |
 * | content（SlotNode） | content | resolve 后放入 content 数组 |
 * | icon（字面量） | icon | ctx.resolveIcon() |
 * | icon（DataBinding） | icon | ComputedValue + containsJSX |
 *
 * ## 特殊逻辑
 *
 * - 同 Steps/Table 的"吞噬 children → data prop"模式
 * - eview-react 的 content 是对象数组 `{ text }` 格式，需包裹
 * - icon 字面量用 resolveIcon 直出，DataBinding 走 ComputedValue
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { LoopNode } from '../../../src/core/nodeTypes'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

/** 从 TimelineItem 节点 props 中提取字段映射信息 */
interface ItemFieldMap {
  dateField: string | null; dateValue: string | null
  contentField: string | null; contentValue: string | null; contentIsSlot: boolean
  iconField: string | null; iconValue: string | null
  hasJSX: boolean
}

function extractFieldMap(item: any): ItemFieldMap {
  const p = item?.props || {}
  const m: ItemFieldMap = {
    dateField: null, dateValue: null,
    contentField: null, contentValue: null, contentIsSlot: false,
    iconField: null, iconValue: null,
    hasJSX: false,
  }

  // title（A2UI 中存的是日期字符串）
  if (p.title) {
    if (p.title.type === 'binding') m.dateField = p.title.path
    else if (typeof p.title === 'string') m.dateValue = p.title
  }

  // content（三分支：string / DataBinding / SlotNode）
  if (p.content) {
    if (p.content.type === 'binding') m.contentField = p.content.path
    else if (p.content.type === 'slotNode') m.contentIsSlot = true
    else if (typeof p.content === 'string') m.contentValue = p.content
  }

  // icon（string / DataBinding）
  if (p.icon) {
    if (p.icon.type === 'binding') { m.iconField = p.icon.path; m.hasJSX = true }
    else if (typeof p.icon === 'string') { m.iconValue = p.icon; m.hasJSX = true }
  }

  return m
}

/** 构建 content 数组（eview-react 格式：[{ text: xxx }]） */
function makeContent(content: any): any[] | undefined {
  if (content === null || content === undefined) return undefined
  return [{ text: content }]
}

export function createTimelineMapping(pkg: string): MappingDef {
  return {
    tag: 'TimeLine',
    import: `${pkg}/TimeLine`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const children = node.children
      const outputProps: Record<string, PropValue> = {}

      // ─── 简单 prop ───
      if (props.className) outputProps.className = props.className as PropValue

      // ─── children → data ───
      if (!children) {
        outputProps.data = []
        return { props: outputProps, children: null }
      }

      if (Array.isArray(children)) {
        // ═══ 分支 A：静态 children ═══
        const data: any[] = []
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as any
          const f = extractFieldMap(child)
          const item: Record<string, any> = {
            date: f.dateValue ?? '',
          }

          // content → [{ text: xxx }]
          if (f.contentValue !== null) {
            item.content = makeContent(f.contentValue)
          } else if (f.contentIsSlot) {
            const resolved = ctx.resolveNode(child.props.content.node)
            if (resolved) item.content = makeContent(resolved)
          } else if (f.contentField) {
            // DataBinding → 保持为 BindingValue，jsx-emitter 会 emit 为 state 引用
            item.content = makeContent(child.props.content)
          }

          // icon
          if (f.iconValue) {
            const iconNode = ctx.resolveIcon(f.iconValue)
            if (iconNode) item.icon = iconNode
          } else if (f.iconField) {
            item.icon = Value.computed({
              path: child.props.icon.path,
              pathType: child.props.icon.pathType ?? 'absolute',
              accessPath: child.props.icon.accessPath ?? 'timelineIcon',
              containsJSX: true,
              transform: (raw: any, cvCtx?: any) => {
                const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
                return typeof raw === 'string' ? rIcon(raw) : null
              },
            })
          }

          data.push(item)
        }
        outputProps.data = data as any
        return { props: outputProps, children: null }
      }

      if ((children as any).kind === 'loop') {
        // ═══ 分支 B：循环模板 ═══
        const loop = children as LoopNode
        const tmpl = loop.template.body[0] as any
        if (!tmpl) { outputProps.data = []; return { props: outputProps, children: null } }

        const f = extractFieldMap(tmpl)
        const dataBinding = loop.data as BindingValue

        // SlotNode content 预 resolve
        let resolvedSlot: any = null
        if (f.contentIsSlot) resolvedSlot = ctx.resolveNode(tmpl.props.content.node)

        outputProps.data = Value.computed({
          path: dataBinding.path,
          pathType: dataBinding.pathType ?? 'absolute',
          accessPath: dataBinding.accessPath ?? 'timelineData',
          containsJSX: f.hasJSX,
          transform: (rawData: any, cvCtx?: any) => {
            if (!Array.isArray(rawData)) return []
            const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon

            return rawData.map((item: any, idx: number) => {
              const dataItem: Record<string, any> = {
                date: f.dateField ? (item[f.dateField] ?? '') : (f.dateValue ?? ''),
              }

              // content
              if (f.contentField) {
                dataItem.content = makeContent(item[f.contentField] ?? '')
              } else if (f.contentValue !== null) {
                dataItem.content = makeContent(f.contentValue)
              } else if (resolvedSlot) {
                dataItem.content = makeContent(resolvedSlot)
              }

              // icon
              if (f.iconField) {
                const name = item[f.iconField]
                if (typeof name === 'string') {
                  const iconNode = rIcon(name)
                  if (iconNode) dataItem.icon = iconNode
                }
              } else if (f.iconValue) {
                const iconNode = rIcon(f.iconValue)
                if (iconNode) dataItem.icon = iconNode
              }

              return dataItem
            })
          },
        })

        return { props: outputProps, children: null }
      }

      return { props: outputProps, children: null }
    },
  }
}
