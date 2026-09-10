/**
 * Anchor → Anchor 映射（eview-react，组合式）
 *
 * A2UI Anchor 的 `items`（AnchorItem[] | DataBinding）映射为 eview-react Anchor 的
 * **`AnchorLink` 子组件树**（组合式，非 data prop）。eview-react Anchor 无 `data`/`items`
 * prop，锚点项通过 `<AnchorLink href title target />` 子组件定义（slots=children），
 * `AnchorLink` 是 `@nce/eview-react/Anchor` 的 **named export**（`import Anchor, { AnchorLink }
 * from '@nce/eview-react/Anchor'`）。每个 AnchorLink 节点挂 `import: { source, named: true }`，
 * import-collector 同源合并 default(Anchor) + named(AnchorLink) → `import Anchor, { AnchorLink }`。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | items（字面量） | children（AnchorLink[]） | 递归 buildAnchorLink 静态节点树（_resolved:true） |
 * | items（DataBinding） | children（inline LoopNode） | AnchorLink 模板 + 相对 binding + inline:true（同 Menu tab-branch） |
 * | offsetTop | offsetTop | 同名透传（number） |
 * | container | containerId | 改名透传（CSS 选择器原样含 `#`，eview-react「当作选择器处理」） |
 * | className | className | 透传 |
 *
 * ## AnchorItem 字段
 *
 * A2UI AnchorItem = { key, href, title(string\|DataBinding\|SlotNode), target, children[] }。
 * - href（'#section-1'）→ AnchorLink `href`（eview-react AnchorLink href 接 '#id' 形式，原样）
 * - title → AnchorLink `title`（string\|ReactNode，原样透传；字面量场景 build-trees 已把
 *   `{path}`/`{componentId}` 转成 BindingValue/SlotNode，emitValue 各自处理）
 * - target → AnchorLink `target`
 * - key → 丢弃（eview-react AnchorLink 用 React key 自动处理，不暴露 key prop）
 * - children → 递归子 AnchorLink（多级嵌套）
 *
 * ## DataBinding items 的 inline LoopNode
 *
 * 镜像 Menu tab-branch（[Menu.ts:151-201]）：template = Anchor.Link（相对 binding
 * href/title/target），`inline:true`（不抽离成独立文件，body 直接在 `.map` 回调内渲染）。
 * 据样本数据条件加 target binding、nested-children 内联 LoopNode（同 Menu 据样本加 icon binding）。
 *
 * **nested children 仅支持 2 级**（section→subsection）：嵌套 loop 的 template 是一个**flat**
 * Anchor.Link（`hasNested=false` 终止递归）。原因——真正无界递归需自引用 template（T.children =
 * loop(template=T)），但 import-collector 的 walkChildren（[import-collector.ts:138-142]）对
 * inline loop 的 template.body 做**数据无关的结构递归**，自引用会无限递归。字面量 items 的
 * `buildAnchorLink` 按**有限字面量数据**递归，支持任意深度——需 3+ 级嵌套用字面量 items。
 *
 * **与 Menu tab-branch 的关键差异**：AnchorLink 无注册 A2UI 映射 → template 必须 `_resolved:true`
 * （否则 NodeMapper 把未注册的 PascalCase 组件转成注释占位，[node-mapper.ts:145]）；
 * Menu 的 TabItem 是 `_resolved:false` 走 TabItem 映射（label→title、icon→resolveIcon）。
 *
 * ## 无事件 / 无 active 状态
 *
 * A2UI schema 未声明 onChange/onClick/selectedKey → 不接事件、不做 useState 受控，
 * 不做 eview-react 的 `affix`/`affixTop`（A2UI 无）。组件用默认行为。
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径。eview-ui Anchor API 不兼容
 * （data-array vs composition），不复用本工厂，独立实现见 `../eview-ui/Anchor.ts`。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue, ImportSpec } from '../../../src/core/value-types'
import type { ComponentNode } from '../../../src/core/node-types'
import { Value } from '../../../src/core/value-factory'
import { Node } from '../../../src/core/node-factory'

// ─── 字面量：递归构造 AnchorLink 静态子节点 ───

/**
 * 单个 AnchorItem → `AnchorLink` ComponentNode（_resolved:true + named import）。
 * `AnchorLink` 是 `${pkg}/Anchor` 的 named export，节点挂 `import: { source, named: true }`，
 * import-collector 同源合并父 Anchor 的 default + AnchorLink 的 named →
 * `import Anchor, { AnchorLink } from '...'`。递归处理 nested children（多级嵌套）。
 */
function buildAnchorLink(item: any, linkImport: ImportSpec): ComponentNode {
  const props: Record<string, PropValue> = {}
  if (item.href !== undefined) props.href = item.href as PropValue
  if (item.title !== undefined) props.title = item.title as PropValue
  if (item.target !== undefined) props.target = item.target as PropValue

  let children: ComponentNode[] | null = null
  if (Array.isArray(item.children) && item.children.length > 0) {
    children = item.children.map((c: any) => buildAnchorLink(c, linkImport))
  }

  const node = Node.component({
    component: 'AnchorLink',
    tag: 'AnchorLink',
    import: linkImport,
    props,
    ...(children ? { children } : { selfClosing: true }),
  })
  ;(node as any)._resolved = true
  return node
}

// ─── DataBinding：构造 inline LoopNode 的 AnchorLink 模板 ───

/**
 * 构造 AnchorLink 模板节点（_resolved:true + named import，相对 binding href/title[/target]）。
 * `hasNested` 时 template 的 children = 内联 LoopNode（相对 'children'），其 template 是一个
 * **flat** AnchorLink（`hasNested=false` 终止递归）——支持 2 级嵌套；详见文件头注释。
 *
 * 据样本数据条件加 target binding、nested-children loop（同 Menu 据样本加 icon binding 的
 * [Menu.ts:164-171]）——无该字段时不加 binding，否则 emit 出游离的 `prop={undefined}`。
 */
function buildAnchorLinkTemplate(
  nodeId: string,
  hasTarget: boolean,
  hasNested: boolean,
  linkImport: ImportSpec,
): ComponentNode {
  const props: Record<string, PropValue> = {
    href: Value.binding({ path: 'href', pathType: 'relative', accessPath: 'href' }),
    title: Value.binding({ path: 'title', pathType: 'relative', accessPath: 'title' }),
  }
  if (hasTarget) {
    props.target = Value.binding({ path: 'target', pathType: 'relative', accessPath: 'target' })
  }

  let children: any = undefined
  if (hasNested) {
    // nested inline LoopNode：data = 相对 binding 'children'（外层 loop 每项解析），
    // template = flat AnchorLink（hasNested=false 终止递归，支持 2 级）。
    const childData = Value.binding({
      path: 'children',
      pathType: 'relative',
      accessPath: 'children',
    })
    const nestedTemplate = buildAnchorLinkTemplate(nodeId, hasTarget, false, linkImport)
    const nestedExtract = Node.extract({
      componentName: `${nodeId}LinkChildTemplate`,
      purpose: 'component',
      body: [nestedTemplate],
      _resolved: false,
    })
    const nestedLoop = Node.loop({ data: childData, template: nestedExtract })
    ;(nestedLoop as any).inline = true
    children = nestedLoop
  }

  const node = Node.component({
    component: 'AnchorLink',
    tag: 'AnchorLink',
    import: linkImport,
    props,
    ...(children !== undefined ? { children } : { selfClosing: true }),
  })
  ;(node as any)._resolved = true
  return node
}

// ─── Anchor 映射定义 ───

export function createAnchorMapping(pkg: string): MappingDef {
  return {
    tag: 'Anchor',
    import: `${pkg}/Anchor`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // AnchorLink 是 `${pkg}/Anchor` 的 named export；节点挂 named import，
      // import-collector 同源合并父 Anchor(default) + AnchorLink(named)。
      const linkImport: ImportSpec = { source: `${pkg}/Anchor`, named: true }

      // ─── items → children（AnchorLink 树） ───
      let children: any = null
      if ('items' in props) {
        const items = props.items
        if (items && typeof items === 'object' && items.type === 'binding') {
          // DataBinding → inline LoopNode（AnchorLink 模板 + 相对 binding，inline:true）
          const dataBinding = Value.binding({
            path: items.path,
            pathType: items.pathType ?? 'absolute',
            accessPath: items.accessPath ?? 'anchorItems',
          })
          // 据样本数据条件加 target / nested-children binding（同 Menu 据样本加 icon binding）
          const sample: any[] = Array.isArray(items.stateValue) ? items.stateValue : []
          const hasTarget = sample.some(
            (it: any) => it && typeof it === 'object' && 'target' in it,
          )
          const hasNested = sample.some(
            (it: any) =>
              it && typeof it === 'object' && Array.isArray(it.children) && it.children.length > 0,
          )
          const nodeId = node.id || 'Anchor'
          const templateItem = buildAnchorLinkTemplate(nodeId, hasTarget, hasNested, linkImport)
          const extract = Node.extract({
            componentName: `${nodeId}LinkTemplate`,
            purpose: 'component',
            body: [templateItem],
            _resolved: false,
          })
          const loop = Node.loop({ data: dataBinding, template: extract })
          ;(loop as any).inline = true
          children = loop
        } else if (Array.isArray(items)) {
          // 字面量 → 静态 AnchorLink 子节点树
          children = items.map((it: any) => buildAnchorLink(it, linkImport))
        }
      }

      // ─── offsetTop 同名透传 ───
      if (props.offsetTop !== undefined) {
        outputProps.offsetTop = props.offsetTop as PropValue
      }

      // ─── container → containerId 改名透传（CSS 选择器原样含 #） ───
      if (props.container !== undefined) {
        outputProps.containerId = props.container as PropValue
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className as PropValue
      }

      // 不做剩余兜底透传：A2UI Anchor 的 props (offsetTop/container/items/className)
      // 已逐项显性处理（id 由管线别处处理，不进 outputProps）。

      return {
        props: outputProps,
        children,
      }
    },
  }
}
