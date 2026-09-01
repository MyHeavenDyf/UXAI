/**
 * Drawer → Drawer 映射（eview-ui 本地工厂副本）
 *
 * eview-ui 的 Drawer 与 eview-react 的 Drawer 存在差异：eview-ui 默认要加 `height='100%'`
 * （仅 right/left/缺省 时加，top/bottom 不加），eview-react 不加。width 两边一致——
 * 都是 A2UI `width`(number) 同名透传、无默认。故不再复用 eview-react 工厂，本文件为其本地副本。
 *
 * ## 尺寸（本副本与 eview-react 的差异）
 *
 * - width：A2UI `width`(number) 同名透传，无默认（与 eview-react 一致）。
 * - height：默认 `'100%'`，仅 placement 为 right/left/缺省 时加（top/bottom 不加）。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-ui prop | 处理方式 |
 * |-----------|---------------|---------|
 * | open（DataBinding） | visible | **ComputedValue.useState**（event:onClose）；shared→useSharedState，非共享→局部 useState |
 * | onClose（Action） | — | 丢弃（onClose 回调由 open 的 useState extractor 生成，closeVal 取自 Action.value，数据驱动） |
 * | placement（right/left/top/bottom） | placement | 同名透传 |
 * | width（number） | width | 同名透传（number 值原样，无默认；与 eview-react 一致） |
 * | mask（boolean，默认 true） | maskSetting.show | 嵌套对象（`maskSetting: { show?: boolean }`，eview-ui Drawer 专属形态） |
 * | title（字面量 string） | title | 同名透传 |
 * | title（DataBinding） | title | BindingValue 同名透传 |
 * | footer（SlotNode） | footer | resolve 后包 SlotNode 直接赋 prop（eview-ui Drawer 有 `footer: ReactNode | false` prop，不像 eview-react 无独立 footer slot） |
 * | className | className | 透传 |
 * | children（StaticChildren） | children | 透传（body content）；footer 不再并入 children（直接走 footer prop） |
 * | — | height | 默认 '100%'（仅 right/left/缺省 时加，top/bottom 不加） |
 * | — | showClose | 默认 true（Drawer 默认），不显式设置 |
 * | — | destroyOnClose | 默认 false（Drawer 默认），不显式设置 |
 *
 * ## 特殊逻辑
 *
 * - open 是 DataBinding（A2UI schema 无字面量形态），产生 ComputedValue.useState（event:onClose）。
 *   path 命中 eventMutatedPaths 时 state-builder 打 shared → useSharedState（跨组件响应式）；否则局部 useState。
 *   两种场景皆由 extractor `()=>setter(closeVal)` 关闭：setter 自适应（useSharedState setter / 局部 setter）。
 * - onClose Action 丢弃：onClose 回调由 open 的 useState extractor 自动生成；closeVal 取自 Action.value（数据驱动）。
 *   open.path 与 onClose.path 按协议一致（"typically same path"），extractor 走 open 的 setter 即写正确路径。
 * - footer SlotNode 直接赋 footer prop：eview-ui Drawer 有独立 `footer: ReactNode | false` prop
 *   （与 eview-react 不同——eview-react 无独立 footer slot，故其副本把 footer 追加到 children）。
 *   resolve 后包 SlotNode 作 prop 值：emitValue 对 slotNode 走 emitNode、tree-finalizer
 *   walkSlotNodeProps 路由子树内 LoopNode/binding（见 AGENTS §6.12）。
 * - mask → maskSetting.show：eview-ui Drawer 的遮罩走嵌套对象 `maskSetting: { show?: boolean }`
 *   （eview-react 为扁平 `showMask`）。A2UI mask=true（显示遮罩）= maskSetting.show=true。
 * - placement 同名透传：A2UI 与 eview-ui 的枚举值一致（right/left/top/bottom）
 * - **width 纯透传无默认**：A2UI `width`(number) 同名透传（与 eview-react 一致），不产 'auto' 默认。
 * - **height 条件默认**：right/left/缺省 时加 `height='100%'`，top/bottom 不加
 *   （此为本副本与 eview-react 的唯一差异——eview-react 不加任何 height）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

export function createDrawerMapping(pkg: string): MappingDef {
  return {
    tag: 'Drawer',
    import: `${pkg}/Drawer`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Drawer 的 props 是封闭集合
      // (open/onClose/placement/width/mask/title/footer/className)，不做兜底透传。

      // ─── open → visible（DataBinding + useState 受控，共享/非共享由 shared 标记自适应） ───
      // open 是 DataBinding（schema 无字面量形态），Drawer 是受控组件，产生 useState：
      //   - path 命中 eventMutatedPaths（被 onClose / 他处 Action 改写）→ state-builder 打 shared
      //     → tree-finalizer useState lift 输出 useSharedState（跨组件响应式订阅 + setter 写 store）
      //   - 非共享 → 局部 useState（自包含受控）
      // onClose 的关闭语义由 extractor `()=>setter(closeVal)` 实现：setter 在共享时为 useSharedState
      // setter（写 store）、非共享时为局部 useState setter。closeVal 取自 onClose Action.value（数据驱动）。
      if ('open' in props) {
        const val = props.open
        const closeVal = (props.onClose as any)?.value ?? false   // onClose Action 的 value
        const extractor = (setter: string) => `() => ${setter}(${JSON.stringify(closeVal)})`
        if (val && typeof val === 'object' && val.type === 'binding') {
          outputProps.visible = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            useState: { event: 'onClose', extractor },
            transform: (rawValue) => !!rawValue,
          })
        } else {
          // 防御性分支：open 理论上只有 DataBinding；字面量直接用
          outputProps.visible = Value.literal({ value: val ?? false, useState: { event: 'onClose', extractor } })
        }
      }

      // ─── onClose（Action）— 丢弃 ───
      // onClose 的 setState 语义已由 open 的 useState extractor 实现（setter 写 open 同路径）。
      // 不透传 ActionValue：open.path 与 onClose.path 按协议一致（"typically same path"），
      // extractor 走 open 的 setter 即写到正确路径；且非共享场景 ActionValue→setSharedState 不适用
      // （无 store 可写），extractor 的 setter 自适应（局部/store）才覆盖两种场景。
      // （onClose Action 的 value 已被 extractor 读取用于 closeVal。）
      if ('onClose' in props) {
        // 丢弃：onClose 回调由 open 的 useState extractor 自动生成
      }

      // ─── placement（同名透传） ───
      // A2UI 与 eview-ui 的枚举值一致：right/left/top/bottom
      if ('placement' in props) {
        outputProps.placement = props.placement
      }

      // ─── width（number 同名透传，无默认；与 eview-react 一致） ───
      if ('width' in props) {
        outputProps.width = props.width
      }

      // ─── height 默认（条件式，本副本与 eview-react 的唯一差异） ───
      // 仅 right/left/缺省 时加（垂直方向抽屉，高度占满）；top/bottom 不加。
      // eview-react 不加任何 height。width 无默认（纯 A2UI 透传）。
      if (!('placement' in props) || props.placement === 'right' || props.placement === 'left') {
        outputProps.height = '100%'
      }

      // ─── mask → maskSetting.show（嵌套对象，eview-ui Drawer 专属形态） ───
      // eview-ui Drawer 的遮罩走 `maskSetting: { show?: boolean }`（eview-react 为扁平 showMask）。
      // A2UI mask=true（显示遮罩）= maskSetting.show=true。
      if ('mask' in props) {
        outputProps.maskSetting = { show: props.mask }
      }

      // ─── title（同名透传，支持字面量 / DataBinding） ───
      if ('title' in props) {
        outputProps.title = props.title
      }

      // ─── footer（SlotNode → 直接赋 footer prop） ───
      // eview-ui Drawer 有独立 `footer: ReactNode | false` prop（与 eview-react 不同——
      // eview-react 无独立 footer slot、其副本把 footer 追加到 children）。resolve 后包 SlotNode
      // 作 prop 值：emitValue 对 slotNode 走 emitNode、tree-finalizer walkSlotNodeProps 路由子树
      // 内 LoopNode/binding（见 AGENTS §6.12）。
      if (props.footer && typeof props.footer === 'object' && props.footer.type === 'slotNode') {
        const footerNode = ctx.resolveNode(props.footer.node)
        if (footerNode) {
          outputProps.footer = Value.slotNode({ node: footerNode as any })
        }
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // 不做剩余兜底透传：A2UI Drawer 的 props 已逐项显性处理。

      // ─── children：纯 body content ───
      // footer 不再并入 children（直接走 footer prop，eview-ui Drawer 有独立 footer slot）。
      // 无 footer → 不返回 children，管线使用原始 children（body content）。
      return {
        props: outputProps,
        propRoute: { visible: 'component-internal' },
      }
    },
  }
}
