/**
 * eview-ui Dropdown 映射（bespoke）
 *
 * 与 eview-react Dropdown 的差异：eview-react 把 A2UI `menu` 数据转换为 `data` 数组
 * （label→text, key→value, icon→resolveIcon）；eview-ui 的 `overlay` prop 是一个**组件节点**
 * ——eview-ui 的 `Menu` 组件，用法 `<Menu><Menu.Item>label</Menu.Item>...</Menu>`，
 * Menu.Item 支持 `icon`（URL）+ `key`，label 作 children。
 *
 * - 字面量 menu → 静态构造 Menu + N 个 Menu.Item / Menu.SubMenu（buildMenuItem 逐项）。
 * - DataBinding menu → **overlay 烘焙为 containsJSX:true CV**：transform 期（state-builder
 *   materialization）拿已解析的 rawData 烘焙静态 Menu 树（同 buildMenuOverlayFromLiteral）。
 *   绝对/相对路径同机制（transform 期数据已解析，相对路径也能正确按 per-item children 切
 *   Item/SubMenu）。替掉旧 inline LoopNode + resolveAbsoluteStateValue workaround（那套只认绝对路径、
 *   相对路径 fallback flat、且要求均匀嵌套契约）。输出 `.map` → 烘焙静态项（与 eview-react 的
 *   baking 哲学一致：JSON 是固定/完整的，编译期烘焙是正常的）。
 *
 *   不使用 override：eview-ui 无组件切换（始终 Dropdown + overlay=Menu），override 是 eview-react
 *   DropDown↔PopUpMenu 切换用的，此处无对应场景。
 *
 * ## 烘焙 CV 的序列化路径
 *
 * containsJSX:true CV 的 transform 返回 Menu BuildNode → state-builder 推入 jsxLiteralConsts →
 * file-assembler serializeForConstValue 对有 node-field children 的 BuildNode 走 emitNode（含 children
 * 递归 / TextNode 裸文本 / 数组 join 无括号 / dotted tag），输出 `const xxx = <Menu>...</Menu>`，
 * prop 位 `overlay={xxx}`（bindingRef 引用 const 名）。collectImportsFromConstValues 收 Menu 的
 * MENU_IMPORT。Menu 树全字面量（key/icon/title/label 均 rawData 字面量，无 binding）→ 无 bindingRefs/
 * stateEntries，符合 containsJSX:true「全烘焙」语义。
 *
 * ⚠️ icon 差异：eview-ui 的 icon 相关属性只接 URL、不接 React DOM，故 Menu.Item 的 icon
 * 一律用统一占位 URL（写死），不调 resolveIcon。字面量与烘焙 CV 两分支皆是。
 *
 * 字面量 overlay 构造成 Menu 节点后包成 SlotNode（Value.slotNode({node})）放入 prop（字面量走
 * slotNode→emitNode 内联 emit `<Dropdown overlay={<Menu>...</Menu>} />`；binding 走烘焙 CV 抽 const）。
 * SlotNode 是 pipeline 既定的"子树作 prop 值"机制，emitValue 对 slotNode 走 emitNode（完整 emit 含
 * children），stateBuilder 的 consumeValue 也 walk(slotNode.node) 收集子树 binding/icon。
 * placement 直接透传、trigger→trigger(首项)、children 透传、className 透传同 eview-react。
 *
 * Menu / Menu.Item 均 default import 自 @cloudsop/eview-ui/Menu，emit `<Menu>` / `<Menu.Item>`（dotted）。
 * 节点 _resolved:true 保留此处设定的 import（否则 registry 兜底会覆盖成 @/components/...）。
 *
 * 字面量分支由 dropdownTest 测试页（literalDropdown）覆盖；binding 分支由同页 bindingDropdown 覆盖。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import type { ComponentNode } from '../../../src/core/node-types'
import { Value } from '../../../src/core/value-factory'
import { Node } from '../../../src/core/node-factory'
import { PLACEHOLDER_ICON_URL } from './icon-placeholder'

const MENU_IMPORT = '@cloudsop/eview-ui/Menu'   // default import，Menu 与 Menu.Item 共用

// ─── Menu.Item 构造 ───

/**
 * 单个 menu item → Menu.Item / Menu.SubMenu 节点（_resolved:true 保留 import）。
 * - **有 children**（子菜单）→ `Menu.SubMenu`：label→title prop、key→prop、icon→占位 URL、
 *   children 递归 buildMenuItem 作 SubMenu children（多级嵌套，同形递归）。
 * - **无 children** → `Menu.Item`：label→children(TextNode)、icon→占位 URL、key→prop。
 *
 * 字面量与烘焙 CV 两分支共用：烘焙 CV 的 transform 期对 rawData 逐项调 buildMenuItem，
 * per-item 按 `item.children` 切 Item/SubMenu（**不再要求均匀嵌套契约**——每项独立判定）。
 *
 * ⚠️ SubMenu 的 `title` 是 prop（ReactNode，此处传字面量 string）；`children` 才是子菜单项。
 *    与 Menu.Item 不同（Menu.Item 的 label 走 children TextNode）。
 * ⚠️ icon：eview-ui icon 边界只接 URL → 一律占位 URL（写死，不调 resolveIcon）。
 */
function buildMenuItem(item: any): ComponentNode {
  // ── 有 children 子菜单 → Menu.SubMenu（递归） ──
  if (Array.isArray(item.children) && item.children.length > 0) {
    const props: Record<string, PropValue> = {}

    // key 透传（字面量 / 烘焙 CV 期 rawData 字面量）
    if (item.key !== undefined) props.key = item.key as PropValue

    // icon：占位 URL（写死，eview-ui icon 只接 URL）
    if (item.icon !== undefined) {
      props.icon = PLACEHOLDER_ICON_URL
    }

    // label → title prop（SubMenu 的标题是 prop，不是 children）
    if (item.label !== undefined) {
      props.title = item.label as PropValue
    }

    // children 递归：子项继续走 buildMenuItem（Item 或 SubMenu，支持多级嵌套）
    const subChildren = item.children.map((c: any) => buildMenuItem(c))

    return {
      kind: 'component',
      component: 'Menu.SubMenu',
      tag: 'Menu.SubMenu',
      // 不声明 import：Menu.SubMenu 内联在父 Menu 内（dotted access <Menu.SubMenu>），
      // 复用父 Menu 的 default import，与 Menu.Item 同理。
      props,
      children: subChildren,
      _resolved: true,
    } as ComponentNode
  }

  // ── 无 children → Menu.Item ──
  const props: Record<string, PropValue> = {}

  // key 透传
  if (item.key !== undefined) props.key = item.key as PropValue

  // icon：占位 URL（写死，不管字面量还是烘焙 CV——eview-ui icon 只接 URL）
  if (item.icon !== undefined) {
    props.icon = PLACEHOLDER_ICON_URL
  }

  // label → children（TextNode，string）
  let children: any[] | null = null
  if (item.label !== undefined) {
    children = [Node.text({ value: item.label as any })]
  }

  return {
    kind: 'component',
    component: 'Menu.Item',
    tag: 'Menu.Item',
    // 不声明 import：Menu.Item 内联在父 Menu 内，通过 dotted access 复用父 Menu 的 default import。
    props,
    children,
    selfClosing: !children,
    _resolved: true,
  } as ComponentNode
}

/**
 * menu 数组 → Menu overlay 节点（_resolved:true）。
 * 字面量分支与烘焙 CV 分支共用：字面量直接调；烘焙 CV 的 transform 期对 rawData 调。
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

// ─── eview-ui Dropdown 映射定义 ───

const DropdownMapping: MappingDef = {
  tag: 'Dropdown',
  import: '@cloudsop/eview-ui/Dropdown',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}

    // 显性处理每个 A2UI prop（Dropdown: placement/trigger/menu/className），不做兜底透传。

    // ─── menu → overlay（Menu 组件节点） ───
    if (props.menu) {
      const menu = props.menu
      if (menu && typeof menu === 'object' && menu.type === 'binding') {
        // DataBinding → overlay 烘焙为 containsJSX:true CV：transform 期（state-builder materialization）
        // 拿已解析的 rawData 烘焙静态 Menu 树（buildMenuItem 逐项 Item/SubMenu，per-item 切形状——
        // 不再要求均匀嵌套契约）。绝对/相对路径同机制（transform 期数据已解析），替掉旧 inline
        // LoopNode + resolveAbsoluteStateValue（那套只认绝对路径、相对 fallback flat）。
        // 输出 .map→烘焙静态项；不使用 override（eview-ui 无组件切换）。
        outputProps.overlay = Value.computed({
          path: menu.path,
          pathType: menu.pathType ?? 'absolute',
          accessPath: menu.accessPath ?? 'dropdownMenu',
          containsJSX: true,
          transform: (rawData: any) =>
            buildMenuOverlayFromLiteral(Array.isArray(rawData) ? rawData : []),
        })
      } else if (Array.isArray(menu)) {
        // 字面量 → 静态 Menu + Menu.Item（包 SlotNode 作 prop 值，emitValue→emitNode 内联 emit）
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
