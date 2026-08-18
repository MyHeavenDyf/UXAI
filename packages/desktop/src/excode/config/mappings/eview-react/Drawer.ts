/**
 * Drawer → Drawer 映射
 *
 * A2UI Drawer → eview-react Drawer 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | open（DataBinding） | visible | **ComputedValue.useState**（event:onClose）；shared→useSharedState，非共享→局部 useState |
 * | onClose（Action） | — | 丢弃（onClose 回调由 open 的 useState extractor 生成，closeVal 取自 Action.value，数据驱动） |
 * | placement（right/left/top/bottom） | placement | 同名透传 |
 * | mask（boolean，默认 true） | showMask | 改名（A2UI mask → eview-react showMask，语义一致） |
 * | title（字面量 string） | title | 同名透传 |
 * | title（DataBinding） | title | BindingValue 同名透传 |
 * | footer（SlotNode） | — | resolve 后追加到 children（Drawer 无独立 footer slot，内容合并到 body） |
 * | className | className | 透传 |
 * | children（StaticChildren） | children | 透传（body content），如有 footer SlotNode 则追加到 children 数组 |
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
 * - footer SlotNode 追加到 children：eview-react Drawer 没有独立 footer slot，
 *   SlotNode 内含任意 React 内容（如 div 包裹按钮），无法转为结构化 footer，因此追加到 children
 * - mask → showMask 改名：A2UI mask=true（显示遮罩）= eview-react showMask=true（显示遮罩）
 * - placement 同名透传：A2UI 与 eview-react 的枚举值一致（right/left/top/bottom）
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
      // (open/onClose/placement/mask/title/footer/className)，不做兜底透传。

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
      // A2UI 与 eview-react 的枚举值一致：right/left/top/bottom
      if ('placement' in props) {
        outputProps.placement = props.placement
      }

      // ─── mask → showMask（改名，语义一致） ───
      if ('mask' in props) {
        outputProps.showMask = props.mask
      }

      // ─── title（同名透传，支持字面量 / DataBinding） ───
      if ('title' in props) {
        outputProps.title = props.title
      }

      // ─── footer（SlotNode → 追加到 children） ───
      // eview-react Drawer 没有独立 footer slot，
      // SlotNode 内含任意 React 内容（如 div 包裹按钮），无法转为结构化 footer，
      // 因此 resolve 后追加到 children 数组。
      let footerNode: any = null
      if (props.footer && typeof props.footer === 'object' && props.footer.type === 'slotNode') {
        footerNode = ctx.resolveNode(props.footer.node)
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // 不做剩余兜底透传：A2UI Drawer 的 props 已逐项显性处理。

      // ─── children：body + footer 合并 ───
      // 如果有 footer SlotNode，追加到原始 children 后面
      const result: any = {
        props: outputProps,
        propRoute: { visible: 'component-internal' },
      }

      if (footerNode) {
        // 有 footer → 合并 body children + footer
        const bodyChildren = node.children || []
        result.children = [...bodyChildren, footerNode]
      }
      // 无 footer → 不返回 children，管线使用原始 children（body content）

      return result
    },
  }
}
