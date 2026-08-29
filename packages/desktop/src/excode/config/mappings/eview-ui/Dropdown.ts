/**
 * eview-ui Dropdown 映射（bespoke）
 *
 * 与 eview-react Dropdown 的差异：eview-react 把 A2UI `menu` 数据转换为 `data` 数组
 * （label→text, key→value, icon→resolveIcon）；eview-ui 的 `data`（即 `overlay` prop）
 * 是一个**组件节点**——eview-ui 的 `Menu` 组件，用法 `<Menu><Menu.Item>label</Menu.Item>...</Menu>`，
 * Menu.Item 支持 `icon`（resolved BuildNode）+ `key`，label 作 children。
 *
 * - 字面量 menu → 静态构造 Menu + N 个 Menu.Item（label TextNode、icon 占位 URL、key 透传）
 * - DataBinding menu → overlay 的 Menu children 用 inline LoopNode（数据源 = menu binding），
 *   template body 为一个 Menu.Item（label/key 走相对绑定；icon 写死占位 URL）。inline 而非
 *   抽离模板：Menu.Item 是 Menu 的子组件（dotted access），必须留在父 Menu 作用域内复用
 *   其 default import，抽离成独立文件会脱离作用域。template 的 Menu.Item 自带 key={key}
 *   （相对绑定），emitLoop 检测到首元素已有 key prop 时跳过 key={idx} 注入避免冲突。
 *
 * ⚠️ icon 差异：eview-ui 的 icon 相关属性只接 URL、不接 React DOM，故 Menu.Item 的 icon
 * 一律用统一占位 URL（写死），不调 resolveIcon。字面量与 LoopNode 模板两分支皆是。
 *
 * overlay 构造成 Menu 节点后包成 SlotNode（Value.slotNode({node})）放入 prop：SlotNode 是 pipeline
 * 既定的"子树作 prop 值"机制，emitValue 对 slotNode 走 emitNode（完整 emit 含 children），
 * stateBuilder 的 consumeValue 也 walk(slotNode.node) 收集子树 binding/icon。
 * placement 直接透传、trigger→trigger(首项)、children 透传、className 透传同 eview-react。
 *
 * Menu / Menu.Item 均 default import 自 @cloudsop/eview-ui/Menu，emit `<Menu>` / `<Menu.Item>`（dotted）。
 * 节点 _resolved:true 保留此处设定的 import（否则 registry 兜底会覆盖成 @/components/...）。
 *
 * ⚠️ DataBinding（inline LoopNode）分支：相对绑定 key/label + 循环内 icon 占位 URL，由
 * dropdownTest 测试页（bindingDropdown）覆盖。字面量分支由同页 literalDropdown 覆盖。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue, BindingValue } from '../../../src/core/value-types'
import type { ComponentNode, LoopNode } from '../../../src/core/node-types'
import { Value } from '../../../src/core/value-factory'
import { Node } from '../../../src/core/node-factory'
import { PLACEHOLDER_ICON_URL } from './icon-placeholder'

const MENU_IMPORT = '@cloudsop/eview-ui/Menu'   // default import，Menu 与 Menu.Item 共用

// ─── Menu.Item 构造 ───

/**
 * 字面量 menu item → Menu.Item 节点（_resolved:true 保留 import）。
 * label→children(TextNode)，icon→占位 URL（写死），key→prop。
 */
function buildMenuItem(item: any): ComponentNode {
  const props: Record<string, PropValue> = {}

  // key 透传（字面量 / binding）
  if (item.key !== undefined) props.key = item.key as PropValue

  // icon：占位 URL（写死，不管字面量还是 DataBinding——eview-ui icon 只接 URL）
  if (item.icon !== undefined) {
    props.icon = PLACEHOLDER_ICON_URL
  }

  // label → children（TextNode，string / binding）
  let children: any[] | null = null
  if (item.label !== undefined) {
    children = [Node.text({ value: item.label as any })]
  }

  return {
    kind: 'component',
    component: 'Menu.Item',
    tag: 'Menu.Item',
    // 不声明 import：Menu.Item 内联在父 Menu 内（overlay=<Menu>...</Menu>），通过 dotted access
    // 复用父 Menu 的 default import（import Menu from @cloudsop/eview-ui/Menu）。inline 循环不抽离
    // 模板文件，Menu.Item 始终在 Menu 作用域内，无需自身 import。
    props,
    children,
    selfClosing: !children,
    _resolved: true,
  } as ComponentNode
}

/**
 * Menu.Item 模板（DataBinding 分支，相对绑定）：label/key 走相对路径。
 * icon 写死占位 URL（eview-ui icon 只接 URL，不随 per-item 数据变化）。
 */
function buildMenuItemTemplate(): ComponentNode {
  const props: Record<string, PropValue> = {
    // key：相对绑定 'key'
    key: Value.binding({ path: 'key', pathType: 'relative', accessPath: 'key' }),
    // icon：占位 URL（写死）
    icon: PLACEHOLDER_ICON_URL,
  }

  // label → TextNode（相对绑定 'label'）
  const children = [
    Node.text({ value: Value.binding({ path: 'label', pathType: 'relative', accessPath: 'label' }) }),
  ]

  return {
    kind: 'component',
    component: 'Menu.Item',
    tag: 'Menu.Item',
    // 不声明 import：template 内联在父 Menu 循环内（inline:true LoopNode），Menu.Item 始终在
    // 父 Menu 作用域内，通过 dotted access 复用父 Menu 的 default import。inline 不抽离模板
    // 文件，无需自身 import。
    props,
    children,
    _resolved: true,
  } as ComponentNode
}

/**
 * 字面量 menu 数组 → Menu overlay 节点（_resolved:true）。
 */
function buildMenuOverlayFromLiteral(items: any[]): ComponentNode {
  const children = items.map((it: any) => buildMenuItem(it))
  return {
    kind: 'component',
    component: 'Menu',
    tag: 'Menu',
    import: MENU_IMPORT,
    props: {},
    children,
    _resolved: true,
  } as ComponentNode
}

/**
 * DataBinding menu → Menu overlay 节点，children 为 inline LoopNode（template = Menu.Item 模板）。
 *
 * 用 inline 循环而非抽离模板：Menu.Item 是 Menu 的子组件（dotted access `<Menu.Item>`），
 * 依赖父 Menu 的 default import 在同一文件作用域内。抽离成独立模板文件会脱离父 Menu 作用域，
 * Menu.Item 无法解析。inline 模式下 Menu.Item 始终内联在 overlay=<Menu>...</Menu> 内，
 * 复用父 Menu 的 import。template body 的 Menu.Item 自身不声明 import（见 buildMenuItemTemplate）。
 *
 * template body 的 Menu.Item 自带 key={key}（相对绑定），emitLoop 检测到首元素已有 key prop
 * 时跳过 key={idx} 注入、map 回调用 (item) 签名（无 idx），避免 key 冲突。
 */
function buildMenuOverlayFromBinding(
  menuBinding: BindingValue,
  nodeId: string | undefined,
): ComponentNode {
  // 复用 menu binding 的 path/pathType/accessPath 作循环数据源
  const dataBinding = Value.binding({
    path: menuBinding.path,
    pathType: menuBinding.pathType ?? 'absolute',
    accessPath: menuBinding.accessPath ?? 'dropdownMenu',
  })

  const componentName = `${nodeId || 'Dropdown'}OverlayTemplate`
  const templateItem = buildMenuItemTemplate()

  const extract = Node.extract({
    componentName,
    purpose: 'component',
    body: [templateItem],
    _resolved: false,
  })

  // inline:true → 模板不抽离，body 内联在 overlay 的 <Menu>...</Menu> 内渲染
  const loopNode: LoopNode = Node.loop({ data: dataBinding, template: extract, inline: true })
  // 注：不手动挂 loopScope —— 会形成 loopNode↔template.body↔loopScope 循环引用，
  // stateBuilder consumeValue 遍历 Object.values 时爆栈。相对绑定的作用域由 stateBuilder
  // 走到 LoopNode 时自行建立。

  return {
    kind: 'component',
    component: 'Menu',
    tag: 'Menu',
    import: MENU_IMPORT,
    props: {},
    children: loopNode,
    _resolved: true,
  } as ComponentNode
}

// ─── eview-ui Dropdown 映射定义 ───

const DropdownMapping: MappingDef = {
  tag: 'Dropdown',
  import: '@cloudsop/eview-ui/Dropdown',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}

    // 显性处理每个 A2UI prop（Dropdown: placement/trigger/menu/className），不做兜底透传。

    // ─── menu → overlay（Menu 组件节点，包成 SlotNode 作 prop 值） ───
    // ⚠️ 必须包 SlotNode：consumeValue 对 slotNode 走 walk→walkChildren→processLoop（loop-aware），
    //    emitValue 对 slotNode 走 emitNode（完整 emit 含 LoopNode children）。裸 ComponentNode 在 prop 值
    //    会走「纯对象 Object.entries 递归」+ emitBuildNodeExpr（只认数组 children），LoopNode 两端都崩。
    if (props.menu) {
      const menu = props.menu
      if (menu && typeof menu === 'object' && menu.type === 'binding') {
        // DataBinding → LoopNode 套 Menu.Item
        outputProps.overlay = Value.slotNode({ node: buildMenuOverlayFromBinding(menu as BindingValue, node.id) as any })
      } else if (Array.isArray(menu)) {
        // 字面量 → 静态 Menu + Menu.Item
        outputProps.overlay = Value.slotNode({ node: buildMenuOverlayFromLiteral(menu) as any })
      }
    }

    // ─── placement 直接透传 ───
    if (props.placement !== undefined) {
      outputProps.placement = props.placement as PropValue
    }

    // ─── trigger（数组）→ trigger（单值） ───
    if (props.trigger && Array.isArray(props.trigger) && props.trigger.length > 0) {
      outputProps.trigger = props.trigger[0] as PropValue
    }

    // ─── className ───
    if (props.className) outputProps.className = props.className as PropValue

    // 不做剩余兜底透传：A2UI Dropdown 的 props 已逐项显性处理。

    return {
      props: outputProps,
    }
  },
}

export default DropdownMapping
