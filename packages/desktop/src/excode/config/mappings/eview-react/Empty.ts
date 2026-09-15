/**
 * Empty → Empty 映射
 *
 * A2UI Empty（空状态占位）→ eview-react Empty 组件。
 * 参考 md/eview-react/Empty.md + md/a2ui/api/DataDisplay/Empty.json。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | description（string 字面量） | description | 同名透传（rule 1：改名-only，原语 string） |
 * | description（DataBinding） | description | 同名透传（rule 1：BindingValue 原样，不改值；解析为 string；state-builder 走 binding 收集） |
 * | description（SlotNode `{componentId}`） | description | BuildTrees 已展成 `Value.slotNode({node})`；transform 调 `ctx.resolveNode(node)` 解析子树后**重新包 slotNode** 留作 prop 值（Empty description 接 ReactNode，子树作 prop 值是 pipeline 既定的 slotNode 机制） |
 * | image（string 字面量） | imgSrc | 改名 image→imgSrc，透传（string 为图片 URL） |
 * | image（DataBinding） | imgSrc | 改名 image→imgSrc，BindingValue 原样透传（只改名不改值，解析为 string URL；state-builder 走 binding 收集） |
 * | image（SlotNode `{componentId}`） | icon | **条件分流**：image 是 SlotNode（自定义 ReactNode）→ 走 eview `icon` prop（ReactNode，优先级高于 imgSrc）；调 `ctx.resolveNode(node)` 解析子树后重新包 slotNode |
 * | className | className | 透传 |
 *
 * ## 特殊逻辑
 *
 * - **description/image 三形态**：string / DataBinding / SlotNode。前两者 rule 1 透传（description 同名、image 改名 imgSrc，均不改值）；
 *   SlotNode 形态 BuildTrees 已展成 `{type:'slotNode', node}`，transform 调 `ctx.resolveNode(node)`
 *   触发子树内组件映射解析（§4.3），再重新包 `Value.slotNode({node})` 留作 prop 值——
 *   slotNode 作 prop 值是 pipeline 既定机制（emitValue→emitNode 完整 emit、stateBuilder walk 收集
 *   子树 binding、tree-finalizer walkSlotNodeProps 路由），与 Popover content 同型。
 *   **不留未解析 slotNode 进 outputProps**：ctx.resolveNode 消费掉原始 slotNode 的 node 解析后再包新 slotNode。
 * - **image 条件分流**：eview-react Empty 没有 antd 的 `image` prop，而是拆成 `imgSrc`（string URL）
 *   与 `icon`（ReactNode）。A2UI `image` 按形态分到两个目标 prop：string/DataBinding → imgSrc（URL），
 *   SlotNode → icon（自定义节点，优先级高于 imgSrc）。一个 image prop 按形态分到两个目标 prop。
 * - **antd 预设标识不支持**：schema 里 image string 描述提到 antd 的 `Empty.PRESENTED_IMAGE_DEFAULT/SIMPLE`
 *   预设，eview-react Empty 无此预设（它用 `type: success|fail`）。映射只把 image string 当 URL 给 imgSrc，
 *   antd 预设字符串无 eview 对应（原样传给 imgSrc 会是无效值），属已知 gap。
 * - **type 不注入**：eview 运行时默认 `type='fail'`；schema 无 type prop，映射不注入，缺省走运行时默认。
 * - **children 吞噬**：Empty 数据通过 props（description/image）传入，不支持 children slot（与 schema 一致）。
 * - **无 useState / 无事件**：Empty 无事件，description/image 均只读绑定，不双绑。
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（`${pkg}/Empty`），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

// ─── SlotNode prop 形态判定 + 重新包 slotNode ───
// 与 Popover content 同型：BuildTrees 已把 {componentId} 展成 {type:'slotNode', node}，
// transform 调 ctx.resolveNode(node) 解析子树（触发内含组件映射）后重新包 slotNode 留作 prop 值。
// 不留未解析 slotNode 进 outputProps。
function isSlotNode(v: any): v is { type: 'slotNode'; node: any } {
  return v && typeof v === 'object' && v.type === 'slotNode'
}

export function createEmptyMapping(pkg: string): MappingDef {
  return {
    tag: 'Empty',
    import: `${pkg}/Empty`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop（Empty: description/image/className），不做兜底透传。

      // ─── description（string | DataBinding | SlotNode 三形态） ───
      // string/DataBinding → rule 1 同名透传（不改值）；
      // SlotNode → ctx.resolveNode 解析子树后重新包 slotNode 留作 description prop（ReactNode）。
      if (props.description !== undefined) {
        const desc = props.description
        if (isSlotNode(desc)) {
          outputProps.description = Value.slotNode({ node: ctx.resolveNode(desc.node) })
        } else {
          // string 字面量 / DataBinding → rule 1 同名透传（不改值）
          outputProps.description = desc as PropValue
        }
      }

      // ─── image（string | DataBinding | SlotNode 三形态，条件分流） ───
      // string/DataBinding → 改名 image→imgSrc（URL，不改值）；
      // SlotNode → 条件分流到 eview icon prop（自定义 ReactNode，优先级高于 imgSrc）。
      if (props.image !== undefined) {
        const img = props.image
        if (isSlotNode(img)) {
          // SlotNode → icon（ReactNode）：解析子树后重新包 slotNode
          outputProps.icon = Value.slotNode({ node: ctx.resolveNode(img.node) })
        } else {
          // string 字面量 / DataBinding → 改名 image→imgSrc（只改名，不改值）
          outputProps.imgSrc = img as PropValue
        }
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className as PropValue
      }

      // 不做剩余兜底透传：A2UI Empty 的 props 已逐项显性处理。
      // children 吞噬：Empty 数据通过 props 传入，不支持 children slot（与 schema 一致）。

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
