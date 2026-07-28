/**
 * Divider → Divider 映射（新架构）
 *
 * A2UI Divider → eview-react Divider 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | value（字面量 string） | children | 转为 TextNode 作为 children |
 * | value（DataBinding） | children | 转为 TextNode 含 BindingValue 作为 children |
 * | value（SlotNode） | children | 展开 slotNode.node 为 children |
 * | orientation: horizontal/vertical | type: horizontal/vertical | 改名透传 |
 * | titlePlacement: start | orientation: left | 值映射 |
 * | titlePlacement: end | orientation: right | 值映射 |
 * | titlePlacement: center | orientation: center | 值映射 |
 * | variant: dashed | dashed: true | 值映射（dotted/solid → 丢弃） |
 * | variant: dotted | — | 丢弃（eview-react 无对应概念） |
 * | variant: solid | — | 丢弃（默认即实线） |
 * | size（large/medium/small） | — | 丢弃（eview-react 无此概念） |
 * | className | className | 透传 |
 *
 * ## 特殊逻辑
 *
 * - value 三分支全部转入 children，不在 props 上保留
 * - titlePlacement 优先处理；若未设 titlePlacement 但设了 orientation，则 orientation 映射为 type
 * - variant 仅 dashed 有对应，其余丢弃
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Node } from '../../../src/core/node'

// ─── 常量 ───

/** titlePlacement → eview-react orientation 值映射 */
const TITLE_PLACEMENT_MAP: Record<string, string> = {
  start: 'left',
  end: 'right',
  center: 'center',
}

/** 透传时跳过的 A2UI prop key */
const SKIP_KEYS = new Set([
  'value', 'orientation', 'titlePlacement', 'variant', 'size', 'className',
])

// ─── Divider 映射定义 ───

export function createDividerMapping(pkg: string): MappingDef {
  return {
    tag: 'Divider',
    import: `${pkg}/Divider`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      let children: any[] | null = null

      // ─── value → children（三分支） ───
      if ('value' in props) {
        const val = props.value

        if (typeof val === 'string') {
          // 分支 1：纯文本 → TextNode
          children = [Node.text({ value: val })]
        } else if (val && typeof val === 'object' && val.type === 'slotNode') {
          // 分支 2：SlotNode → 展开节点的 BuildNode 为 children
          children = [val.node]
        } else if (val && typeof val === 'object' && val.type === 'binding') {
          // 分支 3：DataBinding → TextNode 含 BindingValue（保持原样，管线收集）
          children = [Node.text({ value: val })]
        }
      }

      // ─── titlePlacement → orientation（值映射） ───
      // titlePlacement 语义更明确，优先处理
      if (props.titlePlacement) {
        outputProps.orientation = TITLE_PLACEMENT_MAP[props.titlePlacement] ?? props.titlePlacement
      }

      // ─── orientation → type（改名透传） ───
      // A2UI orientation 指分割线方向（horizontal/vertical），映射到 eview-react type
      // 仅当 titlePlacement 未设时使用，避免混淆
      if (props.orientation && !props.titlePlacement) {
        outputProps.type = props.orientation
      }

      // ─── variant → dashed（仅 dashed 映射） ───
      if (props.variant === 'dashed') {
        outputProps.dashed = true
      }
      // dotted / solid → 丢弃（eview-react 无对应概念）

      // ─── size → 丢弃 ───
      // eview-react Divider 不接受 size prop

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // ─── 透传剩余未处理 prop ───
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
