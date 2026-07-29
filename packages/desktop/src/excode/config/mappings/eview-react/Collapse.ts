/**
 * Collapse → Panel 映射（新架构）
 *
 * A2UI Collapse → eview-react Panel 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | activeKey（字面量） | selectedIndex | 编译期 key→index 匹配 → `Value.literal.useState` + onExpand |
 * | activeKey（DataBinding） | selectedIndex | 编译期 key→index → **ComputedValue.useState** + onExpand |
 * | accordion: false | enableMultiExpand: true | 逻辑映射（false=多开） |
 * | accordion: true/缺省 | — | 默认单展开，不传 |
 * | size | — | 丢弃（Panel 无 size） |
 * | expandIcon | — | 丢弃（Panel 无此概念） |
 * | expandIconPlacement | — | 丢弃 |
 * | className | className | 透传 |
 * | — | onExpand | 通过 useState.event 自动生成 |
 *
 * ## 特殊逻辑
 *
 * - activeKey（string）→ selectedIndex（number[]），匹配方式：
 *   - 静态 children → 遍历 RegularNode[].props.key
 *   - 循环 children → 从 LoopNode.data 取数据数组，遍历 item.key
 * - activeKey 字面量 → LiteralValue.useState
 * - activeKey DataBinding → ComputedValue.useState（值进 state.js）
 * - extractor 处理：单开时 onExpand( index ) → setter([index])
 * - accordion=false 映射为 enableMultiExpand=true
 * - children 透传（PanelItem 作为子节点渲染）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'
import type { LoopNode } from '../../../src/core/nodeTypes'

// ─── 工具 ───

function findIndexInStaticChildren(children: any[] | null | undefined, keyVal: string): number {
  if (!Array.isArray(children)) return -1
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.kind === 'component' && children[i]?.props?.key === keyVal) return i
  }
  return -1
}

/** 从 raw 数据数组中按 id 查找索引 */
function findIndexInRawData(rawData: any[], keyVal: string): number {
  if (!Array.isArray(rawData)) return -1
  for (let i = 0; i < rawData.length; i++) {
    if (rawData[i]?.id === keyVal) return i
  }
  return -1
}

export function createCollapseMapping(pkg: string): MappingDef {
  return {
    tag: 'Panel',
    import: `${pkg}/Panel`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set([
        'activeKey', 'accordion', 'size', 'expandIcon', 'expandIconPlacement', 'className',
      ])

      // ─── 判定 children 形态 ───
      const children = node.children
      const isLoop = children && typeof children === 'object' && children.kind === 'loop'
      const staticChildren = isLoop ? [] : (Array.isArray(children) ? children : [])

      // ─── activeKey → selectedIndex（useState，双形态） ───
      //   字面量 → Value.literal（编译期算索引）
      //   DataBinding → Value.computed.useState（transform 内用 cvCtx 读循环数据算索引，path 直传无需 resolveValueFromPath）
      const hasActiveKey = Object.prototype.hasOwnProperty.call(props, 'activeKey')
      if (hasActiveKey) {
        const rawProp = props.activeKey
        const extractor = (setter: string) => `(index, event) => ${setter}([index])`

        if (rawProp && typeof rawProp === 'object' && rawProp.type === 'binding') {
          // DataBinding → ComputedValue.useState
          const staticChildrenCapture = staticChildren
          const loopCapture = isLoop ? (children as LoopNode) : null
          outputProps.selectedIndex = Value.computed({
            path: rawProp.path,
            pathType: rawProp.pathType ?? 'absolute',
            accessPath: rawProp.accessPath,
            containsJSX: false,
            useState: { event: 'onExpand', extractor },
            transform: (rawActiveKey: any, cvCtx?: any) => {
              const activeKeyVal = rawActiveKey !== undefined && rawActiveKey !== null ? String(rawActiveKey) : ''
              if (!activeKeyVal || activeKeyVal === '') return [0]
              let idx = findIndexInStaticChildren(staticChildrenCapture, activeKeyVal)
              if (idx === -1 && loopCapture) {
                const data = loopCapture.data as BindingValue
                const rawData = data?.path && cvCtx ? (cvCtx.resolveValueFromPath(data.path) ?? []) : []
                idx = findIndexInRawData(rawData, activeKeyVal)
              }
              return [idx !== -1 ? idx : 0]
            },
          })
        } else {
          // 字面量 → Value.literal.useState（编译期算索引）
          const activeKeyVal = typeof rawProp === 'string' ? rawProp : ''
          let selectedIndex = 0
          if (activeKeyVal && activeKeyVal !== '') {
            let idx = -1
            if (isLoop) {
              const data = (children as LoopNode).data as BindingValue
              const rawData = data?.path ? (ctx.resolveAbsoluteStateValue(data.path) ?? []) : []
              idx = findIndexInRawData(rawData, activeKeyVal)
            } else {
              idx = findIndexInStaticChildren(staticChildren, activeKeyVal)
            }
            if (idx !== -1) selectedIndex = idx
          }
          outputProps.selectedIndex = Value.literal({
            value: [selectedIndex],
            useState: { event: 'onExpand', extractor },
          })
        }
      }

      // ─── accordion: false → enableMultiExpand: true ───
      if (props.accordion === false) {
        outputProps.enableMultiExpand = true
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
        // children 透传（PanelItem 作为子节点渲染）
      }
    },
  }
}
