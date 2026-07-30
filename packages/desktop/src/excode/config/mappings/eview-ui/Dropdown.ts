/**
 * eview-ui Dropdown 映射（bespoke）
 *
 * 与 eview-react Dropdown 的差异：eview-react 把 A2UI `menu` 数据转换为 `data` 数组
 * （label→text, key→value, icon→resolveIcon）；eview-ui 的 `data`（即 `overlay` prop）
 * 是一个**组件节点**——eview-ui 的 `Menu` 组件，用法 `<Menu><Menu.Item>label</Menu.Item>...</Menu>`，
 * Menu.Item 支持 `icon`（resolved BuildNode）+ `key`，label 作 children。
 *
 * - 字面量 menu → 静态构造 Menu + N 个 Menu.Item（label TextNode、icon resolveIcon、key 透传）
 * - DataBinding menu → overlay 的 Menu children 用 LoopNode（数据源 = menu binding），
 *   template body 为一个 Menu.Item（label/key/icon 走相对绑定；icon 用 ComputedValue+containsJSX）
 *
 * overlay 构造成 Menu 节点后包成 SlotNode（Value.slotNode({node})）放入 prop：SlotNode 是 pipeline
 * 既定的"子树作 prop 值"机制，emitValue 对 slotNode 走 emitNode（完整 emit 含 children），
 * stateBuilder 的 consumeValue 也 walk(slotNode.node) 收集子树 binding/icon。
 * placement→position+popupDirection、trigger→trigger(首项)、children 透传、className 透传同 eview-react。
 *
 * Menu / Menu.Item 均 default import 自 @cloudsop/eview-ui/Menu，emit `<Menu>` / `<Menu.Item>`（dotted）。
 * 节点 _resolved:true 保留此处设定的 import（否则 registry 兜底会覆盖成 @/components/...）。
 *
 * ⚠️ DataBinding（LoopNode）分支机制较重（ExtractNode 抽取 + 相对绑定 + 循环内 icon），暂无 Dropdown
 * 测试页，需后续用测试页验证。字面量分支已确定。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import type { ComponentNode, LoopNode, ExtractNode } from '../../../src/core/nodeTypes'
import { Value } from '../../../src/core/value'
import { Node } from '../../../src/core/node'

// ─── placement 映射表（与 eview-react Dropdown 一致） ───
const PLACEMENT_MAP: Record<string, { position: string; popupDirection: string }> = {
  bottom:      { position: 'auto', popupDirection: 'bottom' },
  bottomLeft:  { position: 'left', popupDirection: 'bottom' },
  bottomRight: { position: 'right', popupDirection: 'bottom' },
  top:         { position: 'auto', popupDirection: 'top' },
  topLeft:     { position: 'left', popupDirection: 'top' },
  topRight:    { position: 'right', popupDirection: 'top' },
}

const MENU_IMPORT = '@cloudsop/eview-ui/Menu'   // default import，Menu 与 Menu.Item 共用

// ─── Menu.Item 构造 ───

/**
 * 字面量 menu item → Menu.Item 节点（_resolved:true 保留 import）。
 * label→children(TextNode)，icon→resolveIcon(BuildNode)，key→prop。
 */
function buildMenuItem(item: any, ctx: TransformContext): ComponentNode {
  const props: Record<string, PropValue> = {}

  // key 透传（字面量 / binding）
  if (item.key !== undefined) props.key = item.key as PropValue

  // icon：字面量 string → resolveIcon；DataBinding → ComputedValue+containsJSX（absolute）
  if (item.icon !== undefined) {
    if (typeof item.icon === 'string') {
      props.icon = ctx.resolveIcon(item.icon) as any
    } else if (item.icon && typeof item.icon === 'object' && item.icon.type === 'binding') {
      props.icon = Value.computed({
        path: item.icon.path,
        pathType: item.icon.pathType ?? 'absolute',
        accessPath: item.icon.accessPath,
        containsJSX: true,
        transform: (raw: any, cvCtx?: any) => {
          const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
          return typeof raw === 'string' ? rIcon(raw) : null
        },
      })
    }
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
    // 不声明 import：Menu.Item 通过 dotted access 复用父 Menu 的 default import
    // （import Menu from @cloudsop/eview-ui/Menu），避免重复 default 与遍历顺序依赖
    props,
    children,
    selfClosing: !children,
    _resolved: true,
  } as ComponentNode
}

/**
 * Menu.Item 模板（DataBinding 分支，相对绑定）：label/key/icon 走相对路径。
 * icon 用 ComputedValue+containsJSX（循环内 per-item resolveIcon）。
 */
function buildMenuItemTemplate(ctx: TransformContext): ComponentNode {
  const props: Record<string, PropValue> = {
    // key：相对绑定 'key'
    key: Value.binding({ path: 'key', pathType: 'relative', accessPath: 'key' }),
    // icon：相对绑定 'icon' + containsJSX
    icon: Value.computed({
      path: 'icon',
      pathType: 'relative',
      accessPath: 'icon',
      containsJSX: true,
      transform: (raw: any, cvCtx?: any) => {
        const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
        return typeof raw === 'string' ? rIcon(raw) : null
      },
    }),
  }

  // label → TextNode（相对绑定 'label'）
  const children = [
    Node.text({ value: Value.binding({ path: 'label', pathType: 'relative', accessPath: 'label' }) }),
  ]

  return {
    kind: 'component',
    component: 'Menu.Item',
    tag: 'Menu.Item',
    // 不声明 import：复用父 Menu 的 default import（dotted access Menu.Item）
    props,
    children,
    _resolved: true,
  } as ComponentNode
}

/**
 * 字面量 menu 数组 → Menu overlay 节点（_resolved:true）。
 */
function buildMenuOverlayFromLiteral(items: any[], ctx: TransformContext): ComponentNode {
  const children = items.map((it: any) => buildMenuItem(it, ctx))
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
 * DataBinding menu → Menu overlay 节点，children 为 LoopNode（template = Menu.Item 模板）。
 * 镜像 buildTrees #buildLoopTemplate 的结构。
 */
function buildMenuOverlayFromBinding(
  menuBinding: BindingValue,
  nodeId: string | undefined,
  ctx: TransformContext,
): ComponentNode {
  // 复用 menu binding 的 path/pathType/accessPath 作循环数据源
  const dataBinding: BindingValue = {
    type: 'binding',
    path: menuBinding.path,
    pathType: menuBinding.pathType ?? 'absolute',
    accessPath: menuBinding.accessPath ?? 'dropdownMenu',
  }

  const componentName = `${nodeId || 'Dropdown'}OverlayTemplate`
  const templateItem = buildMenuItemTemplate(ctx)

  const extract: ExtractNode = {
    kind: 'extract',
    componentName,
    purpose: 'component',
    body: [templateItem],
    _resolved: false,
  }

  const loopNode: LoopNode = Node.loop({ data: dataBinding, template: extract })
  // 注：不手动挂 loopScope —— 会形成 loopNode↔template.body↔loopScope 循环引用，
  // stateBuilder consumeValue 遍历 Object.values 时爆栈。相对绑定的作用域由 stateBuilder
  // 走到 LoopNode 时自行建立（⚠️ LoopNode 在 prop 值内的整体处理仍待测试页验证）。

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
  tag: 'DropDown',
  import: '@cloudsop/eview-ui/DropDown',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}
    const SKIP_KEYS = new Set(['menu', 'placement', 'trigger'])

    // ─── menu → overlay（Menu 组件节点，直接作 prop 值） ───
    // overlay 是 prop 值里的 BuildNode 子树。jsxEmitter.emitValue 对 prop 值 BuildNode 走
    // emitBuildNodeExpr——该函数原仅处理图标节点（自闭合、不 emit children），已扩展支持 children
    // （见 jsxEmitter.ts emitBuildNodeExpr），故 <Menu><Menu.Item/>...</Menu> 能正确 emit。
    if (props.menu) {
      const menu = props.menu
      if (menu && typeof menu === 'object' && menu.type === 'binding') {
        // DataBinding → LoopNode 套 Menu.Item（⚠️ LoopNode 在 prop 值内仍待验证）
        outputProps.overlay = buildMenuOverlayFromBinding(menu as BindingValue, node.id, ctx) as any
      } else if (Array.isArray(menu)) {
        // 字面量 → 静态 Menu + Menu.Item
        outputProps.overlay = buildMenuOverlayFromLiteral(menu, ctx) as any
      }
    }

    // ─── placement → position + popupDirection ───
    if (props.placement) {
      const mapped = PLACEMENT_MAP[props.placement]
      if (mapped) {
        outputProps.position = mapped.position as PropValue
        outputProps.popupDirection = mapped.popupDirection as PropValue
      }
    }

    // ─── trigger（数组）→ trigger（单值） ───
    if (props.trigger && Array.isArray(props.trigger) && props.trigger.length > 0) {
      outputProps.trigger = props.trigger[0] as PropValue
    }

    // ─── className ───
    if (props.className) outputProps.className = props.className as PropValue

    // 透传剩余
    for (const [key, value] of Object.entries(props)) {
      if (!SKIP_KEYS.has(key)) outputProps[key] = value as PropValue
    }

    return {
      props: outputProps,
    }
  },
}

export default DropdownMapping
