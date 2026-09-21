/**
 * Popover → TipBox 映射
 *
 * A2UI Popover（气泡卡片）→ eview-react TipBox。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | content（string 字面量） | content | 同名透传（rule 1：改名-only，原语 string） |
 * | content（DataBinding） | content | 同名透传（rule 1：BindingValue 原样，不改值；state-builder 走 binding 收集） |
 * | content（SlotNode `{componentId}`） | content | BuildTrees 已展成 `Value.slotNode({node})`；transform 调 `ctx.resolveNode(node)` 解析子树后**重新包 slotNode** 留作 prop 值（TipBox content 接 ReactNode，子树作 prop 值是 pipeline 既定的 slotNode 机制） |
 * | title（string \| DataBinding） | title | 同名透传（rule 1） |
 * | placement | direction | **改名**（placement→direction）；两侧 12 方向枚举完全一致（top/left/right/bottom/topLeft/topRight/bottomLeft/bottomRight/leftTop/leftBottom/rightTop/rightBottom），值原样透传 |
 * | trigger（数组 [click\|hover\|contextMenu]） | trigger | 过滤 `contextMenu`（TipBox 无对应）；剩余 1 项→单值、多项→数组、0 项（全 contextMenu）→省略（TipBox 默认 hover）。缺省→省略（TipBox 默认 hover，与 A2UI 默认 hover 一致） |
 * | className | className | 透传 |
 * | children（恰好 1 个 componentId，触发元素） | children | 透传（不返回 children → 管线沿用原始 node.children；TipBox children 仅支持单元素，与 A2UI 恰好 1 个的约束一致） |
 *
 * ## 特殊逻辑
 *
 * - **content 三形态**：string / DataBinding / SlotNode。前两者 rule 1 同名透传（不改值）；
 *   SlotNode 形态 BuildTrees 已展成 `{type:'slotNode', node}`，transform 调 `ctx.resolveNode(node)`
 *   触发子树内组件映射解析（§4.3），再重新包 `Value.slotNode({node})` 留作 content prop 值——
 *   slotNode 作 prop 值是 pipeline 既定机制（emitValue→emitNode 完整 emit、stateBuilder walk 收集
 *   子树 binding、tree-finalizer walkSlotNodeProps 路由），与 eview-ui Dropdown overlay 同型。
 *   **不留未解析 slotNode 进 outputProps**：ctx.resolveNode 消费掉原始 slotNode 的 node 解析后再包新 slotNode。
 * - **placement→direction 是纯改名**：两侧 12 方向枚举逐字一致（A2UI schema enum === TipBox direction enum），
 *   值原样透传、无需映射表。schema default `top` 是 advisory（同 Modal 的 width 约定），映射不注入，
 *   缺省走 TipBox 运行时默认（topLeft）。
 * - **trigger 过滤 contextMenu**：TipBox trigger 只接 hover/focus/click；A2UI 的 contextMenu 无对应
 *   （TipBox 无右键触发）。过滤后空数组→省略（TipBox 默认 hover）。A2UI default hover 缺省→省略→TipBox 默认 hover，一致。
 * - children 透传：TipBox 以 children 作触发元素（`React.Children.only` 校验单元素），与 A2UI 恰好 1 个触发
 *   元素的约束一致；transform 不返回 children → 管线沿用原始 node.children。
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（`${pkg}/TipBox`），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

export function createPopoverMapping(pkg: string): MappingDef {
  return {
    tag: 'TipBox',
    import: `${pkg}/TipBox`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop（Popover: content/title/placement/trigger/className），不做兜底透传。

      // ─── content（string | DataBinding | SlotNode 三形态） ───
      // content 必填（schema required）。string/DataBinding → rule 1 同名透传（不改值）；
      // SlotNode → BuildTrees 已展成 {type:'slotNode', node}，ctx.resolveNode 解析子树后重新包 slotNode 留作 prop。
      if (props.content !== undefined) {
        const content = props.content
        if (content && typeof content === 'object' && content.type === 'slotNode') {
          // SlotNode：解析子树（触发内含组件映射），重新包 slotNode 作 content prop 值（ReactNode）
          outputProps.content = Value.slotNode({ node: ctx.resolveNode(content.node) })
        } else {
          // string 字面量 / DataBinding → rule 1 同名透传（不改值）
          outputProps.content = content as PropValue
        }
      }

      // ─── title（string | DataBinding → 同名透传，rule 1） ───
      if ('title' in props) {
        outputProps.title = props.title as PropValue
      }

      // ─── placement → direction（纯改名，12 方向枚举逐字一致） ───
      if ('placement' in props) {
        outputProps.direction = props.placement as PropValue
      }

      // ─── trigger（数组 [click|hover|contextMenu]）→ 过滤 contextMenu ───
      // TipBox trigger 只接 hover/focus/click；contextMenu 无对应 → 过滤。
      // 剩余 1 项→单值、多项→数组、0 项（全 contextMenu）→省略（TipBox 默认 hover）。
      // A2UI default hover（缺省）→省略→TipBox 默认 hover，一致。
      if ('trigger' in props && Array.isArray(props.trigger) && props.trigger.length > 0) {
        const mapped = (props.trigger as string[]).filter((t) => t !== 'contextMenu')
        if (mapped.length === 1) {
          outputProps.trigger = mapped[0] as PropValue
        } else if (mapped.length > 1) {
          outputProps.trigger = mapped as unknown as PropValue
        }
        // mapped.length === 0 → 省略（全 contextMenu，TipBox 默认 hover）
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className as PropValue
      }

      // 不做剩余兜底透传：A2UI Popover 的 props 已逐项显性处理。
      // children 透传：不返回 children → 管线沿用原始 node.children（恰好 1 个触发元素，TipBox Children.only）。

      return {
        props: outputProps,
      }
    },
  }
}
