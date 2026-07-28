/**
 * Steps → Steps 映射（新架构）
 *
 * A2UI Steps → eview-react Steps 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | current（字面量/DataBinding） | currentStep | 改名透传 |
 * | orientation | direction | 改名透传 |
 * | types / variant / status / size | — | 丢弃 |
 * | className | className | 透传 |
 * | children（StepItem 列表） | data | **吞噬 children** → 转为 WizardData[] |
 *
 * ## 特殊逻辑
 *
 * - 同 Table 的"吞噬 children → data prop"模式
 * - children 有静态数组和 LoopNode 两种形态
 * - 每个 StepItem 的 props → WizardData 映射：
 *   title → text, content → description, icon → iconUrl, status → status
 * - icon 字面量用 resolveIcon，DataBinding 用 ComputedValue
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { LoopNode } from '../../../src/core/nodeTypes'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

/** 从 StepItem 节点 props 中提取字段映射信息 */
interface StepFieldMap {
  titleField: string | null; titleValue: string | null
  descField: string | null; descValue: string | null; descIsSlot: boolean
  statusField: string | null; statusValue: string | null
  iconField: string | null; iconValue: string | null
  hasJSX: boolean
}

function extractFieldMap(stepItem: any): StepFieldMap {
  const p = stepItem?.props || {}
  const m: StepFieldMap = {
    titleField: null, titleValue: null,
    descField: null, descValue: null, descIsSlot: false,
    statusField: null, statusValue: null,
    iconField: null, iconValue: null,
    hasJSX: false,
  }

  if (p.title) {
    if (p.title.type === 'binding') m.titleField = p.title.path
    else if (typeof p.title === 'string') m.titleValue = p.title
  }
  if (p.content) {
    if (p.content.type === 'binding') m.descField = p.content.path
    else if (p.content.type === 'slotNode') m.descIsSlot = true
    else if (typeof p.content === 'string') m.descValue = p.content
  }
  if (p.status) {
    if (p.status.type === 'binding') m.statusField = p.status.path
    else if (typeof p.status === 'string') m.statusValue = p.status
  }
  if (p.icon) {
    if (p.icon.type === 'binding') { m.iconField = p.icon.path; m.hasJSX = true }
    else if (typeof p.icon === 'string') { m.iconValue = p.icon; m.hasJSX = true }
  }

  return m
}

function buildDataItem(
  item: any,
  idx: number,
  f: StepFieldMap,
  rIcon: (name: string, props?: any) => any,
): Record<string, any> {
  const dataItem: Record<string, any> = {
    text: f.titleField ? (item[f.titleField] ?? '') : (f.titleValue ?? ''),
    value: idx,
  }
  // description
  if (f.descField) dataItem.description = item[f.descField] ?? ''
  else if (f.descValue !== null) dataItem.description = f.descValue
  // icon
  if (f.iconField) {
    const name = item[f.iconField]
    if (typeof name === 'string') { const n = rIcon(name); if (n) dataItem.iconUrl = n }
  } else if (f.iconValue) {
    const n = rIcon(f.iconValue); if (n) dataItem.iconUrl = n
  }
  // status
  if (f.statusField) dataItem.status = item[f.statusField]
  else if (f.statusValue !== null) dataItem.status = f.statusValue

  return dataItem
}

export function createStepsMapping(pkg: string): MappingDef {
  return {
    tag: 'Steps',
    import: `${pkg}/Steps`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const children = node.children
      const outputProps: Record<string, PropValue> = {}

      // ─── 简单 prop ───
      if (props.current !== undefined) {
        const cur = props.current
        outputProps.currentStep = (cur?.type === 'binding') ? cur : (cur as PropValue)
      }
      if (props.orientation) outputProps.direction = props.orientation as PropValue
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
            text: f.titleValue ?? '',
            value: i,
          }

          if (f.descValue !== null) item.description = f.descValue
          else if (f.descIsSlot) {
            // SlotNode content → resolve 后放入
            const resolved = ctx.resolveNode(child.props.content.node)
            if (resolved) item.description = resolved
          } else if (f.descField) {
            // DataBinding → 保持 BindingValue 引用（jsx-emitter 自动 emit）
            item.description = child.props.content
          }

          if (f.iconValue) {
            const n = ctx.resolveIcon(f.iconValue)
            if (n) item.iconUrl = n
          } else if (f.iconField) {
            // DataBinding icon → ComputedValue
            item.iconUrl = Value.computed({
              path: child.props.icon.path,
              pathType: child.props.icon.pathType ?? 'absolute',
              accessPath: child.props.icon.accessPath ?? 'stepIcon',
              containsJSX: true,
              transform: (raw: any, cvCtx?: any) => {
                const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
                return typeof raw === 'string' ? rIcon(raw) : null
              },
            })
          }

          if (f.statusValue) item.status = f.statusValue
          else if (f.statusField) item.status = child.props.status

          data.push(item)
        }
        outputProps.data = data as any
        return { props: outputProps, children: null }
      }

      if ((children as any).kind === 'loop') {
        // ═══ 分支 B：循环模板 ═══
        const loop = children as LoopNode
        const stepItem = loop.template.body[0] as any
        if (!stepItem) { outputProps.data = []; return { props: outputProps, children: null } }

        const f = extractFieldMap(stepItem)
        const dataBinding = loop.data as BindingValue

        // SlotNode content 需要预 resolve
        let resolvedSlot: any = null
        if (f.descIsSlot) resolvedSlot = ctx.resolveNode(stepItem.props.content.node)

        outputProps.data = Value.computed({
          path: dataBinding.path,
          pathType: dataBinding.pathType ?? 'absolute',
          accessPath: dataBinding.accessPath ?? 'stepsData',
          containsJSX: f.hasJSX,
          transform: (rawData: any, cvCtx?: any) => {
            if (!Array.isArray(rawData)) return []
            const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon

            // 如果预展开了 SlotNode → 直接用它
            if (resolvedSlot) {
              return rawData.map((item: any, idx: number) => {
                const d = buildDataItem(item, idx, f, rIcon)
                d.description = resolvedSlot
                return d
              })
            }

            return rawData.map((item: any, idx: number) =>
              buildDataItem(item, idx, f, rIcon),
            )
          },
        })

        return { props: outputProps, children: null }
      }

      return { props: outputProps, children: null }
    },
  }
}
