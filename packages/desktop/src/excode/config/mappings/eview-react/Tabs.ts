/**
 * Tabs → Tab 映射（新架构）
 *
 * A2UI Tabs → eview-react Tab 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | activeKey（字面量/DataBinding） | selectedIndex | 编译期 key→index 匹配 → **LiteralValue.useState**，event: 'onClick' 自动注入 |
 * | types: line/card/editable-card | type: main/sub/sub | 值映射 |
 * | tabPlacement: top/end/bottom/start | position: top/right/bottom/left | 值映射 |
 * | size | size | 透传 |
 * | className | className | 透传 |
 * | — | lazyLoad | `defaults: true` |
 * | — | onClick | 由 selectedIndex 的 useState.event 自动生成，无需手动占位 |
 *
 * ## 特殊逻辑
 *
 * - activeKey（string）→ selectedIndex（number），匹配来源：
 *   - 静态 children → 遍历 RegularNode[].props.key
 *   - 循环 children → 从 LoopNode.data 取数据数组，遍历 item.key
 * - activeKey 可以为字面量或 DataBinding，均需匹配后产生 useState
 * - 无 activeKey 时，不输出 selectedIndex（走组件默认值 0）
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'
import type { LoopNode } from '../../../src/core/nodeTypes'

// ─── 工具 ───

/**
 * 从静态 children（RegularNode[]）中遍历查找 activeKey 对应的索引
 */
function findIndexInStaticChildren(
  children: any[] | null | undefined,
  activeKeyVal: string,
): number {
  if (!Array.isArray(children)) return -1
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child?.kind === 'component' && child.props?.key === activeKeyVal) {
      return i
    }
  }
  return -1
}

/**
 * 从循环数据数组中遍历查找 activeKey 对应的索引
 */
function findIndexInRawData(rawData: any[], activeKeyVal: string): number {
  if (!Array.isArray(rawData)) return -1
  for (let i = 0; i < rawData.length; i++) {
    const item = rawData[i]
    if (item?.key === activeKeyVal) return i
  }
  return -1
}

/**
 * 从循环数据中查找索引（保留兼容，字面量场景用）
 */
function findIndexInLoopData(
  loop: LoopNode,
  activeKeyVal: string,
  ctx: TransformContext,
): number {
  const data = loop.data as BindingValue
  const rawData: any[] = data?.path
    ? (ctx.resolveAbsoluteStateValue(data.path) ?? [])
    : []
  return findIndexInRawData(rawData, activeKeyVal)
}

// ─── Tabs 映射定义 ───

const TabsMapping: MappingDef = {
  tag: 'Tab',
  import: '@nce/eview-react/Tab',

  defaults: {
    lazyLoad: true,
  },

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}
    const SKIP_KEYS = new Set([
      'activeKey', 'types', 'tabPlacement', 'size', 'className',
    ])

    // ─── 判定 children 形态 ───
    const children = node.children
    const isLoop = children && typeof children === 'object' && children.kind === 'loop'
    const staticChildren = isLoop ? [] : (Array.isArray(children) ? children : [])

    // ─── activeKey → selectedIndex（useState，双形态） ───
    //   字面量 → Value.literal（编译期算索引 hardcode）
    //   DataBinding → Value.computed + useState（transform 内算索引，cvCtx 读循环数据，path 直传无需 resolveValueFromPath）
    const hasActiveKey = Object.prototype.hasOwnProperty.call(props, 'activeKey')
    if (hasActiveKey) {
      const activeKeyRaw = props.activeKey
      const extractor = (setter: string) => `(index) => ${setter}(index)`

      if (activeKeyRaw && typeof activeKeyRaw === 'object' && activeKeyRaw.type === 'binding') {
        // DataBinding → ComputedValue.useState
        // 闭包捕获 staticChildren / loop（编译期已知），transform 内用 cvCtx 读循环数据算索引
        const staticChildrenCapture = staticChildren
        const loopCapture = isLoop ? (children as LoopNode) : null
        outputProps.selectedIndex = Value.computed({
          path: activeKeyRaw.path,
          pathType: activeKeyRaw.pathType ?? 'absolute',
          accessPath: activeKeyRaw.accessPath,
          containsJSX: false,
          useState: { event: 'onClick', extractor },
          transform: (rawActiveKey: any, cvCtx?: any) => {
            const activeKeyVal = rawActiveKey !== undefined && rawActiveKey !== null ? String(rawActiveKey) : ''
            if (!activeKeyVal || activeKeyVal === '') return 0
            let idx = findIndexInStaticChildren(staticChildrenCapture, activeKeyVal)
            if (idx === -1 && loopCapture) {
              const data = loopCapture.data as BindingValue
              const rawData = data?.path && cvCtx
                ? (cvCtx.resolveValueFromPath(data.path) ?? [])
                : []
              idx = findIndexInRawData(rawData, activeKeyVal)
            }
            return idx !== -1 ? idx : 0
          },
        })
      } else {
        // 字面量 → Value.literal.useState（编译期算索引）
        const activeKeyVal = typeof activeKeyRaw === 'string' ? activeKeyRaw : ''
        let selectedIndex = 0
        if (activeKeyVal && activeKeyVal !== '') {
          let idx = -1
          if (isLoop) {
            idx = findIndexInLoopData(children as LoopNode, activeKeyVal, ctx)
          } else {
            idx = findIndexInStaticChildren(staticChildren, activeKeyVal)
          }
          if (idx !== -1) selectedIndex = idx
        }
        outputProps.selectedIndex = Value.literal({
          value: selectedIndex,
          useState: { event: 'onClick', extractor },
        })
      }
    }

    // ─── types → type：值映射 ───
    if (props.types === 'line') {
      outputProps.type = 'main'
    } else if (props.types === 'card' || props.types === 'editable-card') {
      outputProps.type = 'sub'
    }

    // ─── tabPlacement → position：值映射 ───
    if (props.tabPlacement === 'top') {
      outputProps.position = 'top'
    } else if (props.tabPlacement === 'end') {
      outputProps.position = 'right'
    } else if (props.tabPlacement === 'bottom') {
      outputProps.position = 'bottom'
    } else if (props.tabPlacement === 'start') {
      outputProps.position = 'left'
    }

    // ─── size 透传 ───
    if (props.size) {
      // size: medium → normal
      outputProps.size = props.size === 'medium' ? 'normal' : props.size
    }

    // ─── className 透传 ───
    if (props.className) {
      outputProps.className = props.className
    }

    // ─── onClick 由 selectedIndex 的 useState.event 自动注入，不手动占位 ───

    // ─── 透传剩余 prop ───
    for (const [key, value] of Object.entries(props)) {
      if (!SKIP_KEYS.has(key)) {
        outputProps[key] = value as PropValue
      }
    }

    return {
      props: outputProps,
      // 透传 children（TabItem 作为子节点渲染）
    }
  },
}

export default TabsMapping
