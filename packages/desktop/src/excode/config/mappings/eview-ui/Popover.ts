/**
 * eview-ui Popover 映射（bespoke）
 *
 * A2UI Popover → eview-ui **Tooltip**（非 eview-react 的 TipBox——eview-ui 无 TipBox，
 * 对应组件是 Tooltip，trigger-based 气泡框，与 A2UI Popover 模型一致）。
 *
 * ## 与 eview-react Popover（→TipBox）的差异点
 *
 * | 维度 | eview-react（TipBox） | eview-ui（Tooltip） | 处理 |
 * |------|----------------------|---------------------|------|
 * | tag/import | TipBox / `${pkg}/TipBox` | Tooltip / `@cloudsop/eview-ui/Tooltip` | bespoke 写死 |
 * | placement | → `direction`（改名，12 枚举逐字一致） | → `placement`（**同名**，12 枚举逐字一致，不改名） | 同名透传 |
 * | title | 透传（TipBox 有 title prop） | **丢弃**（Tooltip 无 title prop） | 丢弃（eview-ui bespoke 丢弃不兼容 prop 的惯例，同 TextArea 丢 autoSize / Steps 丢 orientation） |
 * | content | string/DataBinding rule 1 / SlotNode resolveNode+重包 slotNode | **同**（Tooltip content 接 ReactNode） | 同 react |
 * | trigger | 过滤 contextMenu | **同**（Tooltip trigger hover/focus/click） | 同 react |
 * | className/children | 透传 | **同** | 同 react |
 *
 * ## Props 对照（A2UI Popover → eview-ui Tooltip）
 *
 * | A2UI prop | eview-ui Tooltip prop | 处理方式 |
 * |-----------|----------------------|---------|
 * | content（string） | content | 同名透传（rule 1，原语 string） |
 * | content（DataBinding） | content | 同名透传 BindingValue（rule 1，不改值、不包 computed） |
 * | content（SlotNode `{componentId}`） | content | BuildTrees 已展成 `Value.slotNode({node})`；transform 调 `ctx.resolveNode(node)` 解析子树后**重新包 slotNode** 留作 prop 值（Tooltip content 接 ReactNode，子树作 prop 值是 pipeline 既定 slotNode 机制） |
 * | title | — | **丢弃**（Tooltip 无 title prop；eview-ui bespoke 丢弃不兼容 prop 惯例） |
 * | placement | placement | **同名透传**（两侧 12 方向枚举逐字一致：top/topLeft/topRight/bottom/bottomLeft/bottomRight/left/leftTop/leftBottom/right/rightTop/rightBottom）。schema default `top` 是 advisory，映射不注入，缺省走 Tooltip 默认 `top`（两侧一致） |
 * | trigger（数组 [click\|hover\|contextMenu]） | trigger | 过滤 `contextMenu`（Tooltip 只接 hover/focus/click）；剩 1 项→单值、多项→数组、0 项→省略。缺省→省略（两侧默认均 hover） |
 * | className | className | 透传 |
 * | children（恰好 1 个触发元素） | children | 透传（不返回 children → 管线沿用原始 node.children；Tooltip children 仅接受单元素，与 A2UI 恰好 1 个约束一致） |
 *
 * ## 特殊逻辑
 *
 * - **content 三形态**同 eview-react：string/DataBinding 走 rule 1 同名透传（不改值）；
 *   SlotNode 走 §4.3 `ctx.resolveNode(node)` 解析子树后重新包 `Value.slotNode` 留作 content prop 值
 *   （slotNode 作 prop 值 = pipeline 既定机制，emitValue→emitNode 完整 emit、stateBuilder walk 收集
 *   子树 binding、tree-finalizer walkSlotNodeProps 路由）。不留未解析 slotNode 进 outputProps。
 * - **placement 同名透传**（区别于 eview-react 的 placement→direction 改名）：eview-ui Tooltip 的
 *   placement prop 与 A2UI 的 12 方向枚举逐字一致，故不改名、值原样透传。
 * - **title 丢弃**：eview-ui Tooltip 无 title prop（只有 content）。丢弃 title（eview-ui bespoke
 *   丢弃不兼容 prop 的惯例，同 TextArea 丢 autoSize / Steps 丢 orientation / Progress 丢 status）。
 *   ⚠️ 若 A2UI 同时给了 title + 字面量 content，title 文本会丢失——如需保留可后续改「title 合并进 content」
 *   （但 DataBinding/SlotNode 形态合并复杂，当前按丢弃处理）。
 * - **trigger 过滤 contextMenu**：Tooltip trigger 只接 hover/focus/click；A2UI contextMenu 无对应。
 *   过滤后空数组→省略（Tooltip 默认 hover）。A2UI default hover 缺省→省略→Tooltip 默认 hover，一致。
 * - children 透传：Tooltip 以 children 作触发元素（仅接受单个 React 子元素），与 A2UI 恰好 1 个触发
 *   元素的约束一致；transform 不返回 children → 管线沿用原始 node.children。
 *
 * ⚠️ 不涉及 icon 边界：Tooltip 无 icon 相关属性，content 接 React DOM（非 URL-only），
 *   不走 icon-URL 占位改造。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

const PopoverMapping: MappingDef = {
  tag: 'Tooltip',
  import: '@cloudsop/eview-ui/Tooltip',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}

    // 显性处理每个 A2UI prop（Popover: content/title/placement/trigger/className），不做兜底透传。

    // ─── content（string | DataBinding | SlotNode 三形态） ───
    // string/DataBinding → rule 1 同名透传（不改值）；
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

    // ─── title → 丢弃（eview-ui Tooltip 无 title prop） ───
    // Tooltip 只有 content，无 title slot；丢弃 title（eview-ui bespoke 丢弃不兼容 prop 惯例）。

    // ─── placement → placement（同名透传，12 方向枚举逐字一致） ───
    // 区别于 eview-react 的 placement→direction 改名：eview-ui Tooltip 用 placement，与 A2UI 枚举一致。
    if ('placement' in props) {
      outputProps.placement = props.placement as PropValue
    }

    // ─── trigger（数组 [click|hover|contextMenu]）→ 过滤 contextMenu ───
    // Tooltip trigger 只接 hover/focus/click；contextMenu 无对应 → 过滤。
    // 剩余 1 项→单值、多项→数组、0 项（全 contextMenu）→省略（Tooltip 默认 hover）。
    // A2UI default hover（缺省）→省略→Tooltip 默认 hover，一致。
    if ('trigger' in props && Array.isArray(props.trigger) && props.trigger.length > 0) {
      const mapped = (props.trigger as string[]).filter((t) => t !== 'contextMenu')
      if (mapped.length === 1) {
        outputProps.trigger = mapped[0] as PropValue
      } else if (mapped.length > 1) {
        outputProps.trigger = mapped as unknown as PropValue
      }
      // mapped.length === 0 → 省略（全 contextMenu，Tooltip 默认 hover）
    }

    // ─── className 透传 ───
    if (props.className) {
      outputProps.className = props.className as PropValue
    }

    // 不做剩余兜底透传：A2UI Popover 的 props 已逐项显性处理。
    // children 透传：不返回 children → 管线沿用原始 node.children（恰好 1 个触发元素，Tooltip Children.only）。

    return {
      props: outputProps,
    }
  },
}

export default PopoverMapping
