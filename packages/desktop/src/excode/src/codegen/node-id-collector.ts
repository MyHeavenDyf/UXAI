/**
 * node-id-collector — 收集产物文件 emitted 的 A2UI 元素基础 id
 *
 * 用途（见 PLAN-manifest.md）：设计平台框选 DOM 节点 → 拿到带 `:index` 后缀的
 * 循环展开 id → wiki.js strip 后缀得基础 id → 查 manifest.tree 找该 id 所在的
 * .tsx 产物文件。故管线需在转换时记录「每个 .tsx 产物文件 emitted 了哪些基础 id」。
 *
 * 两个 walker 镜像 file-assembler 既有的 `collectImportsFromConstValues` /
 * `collectLoopRefs` 约定（含 loopScope 跳过 + inline 判定）：
 *
 * ⚠️ 硬约束 #6：`Object.entries` 式遍历若能到达带 `loopScope` 的 BuildNode，
 *    必须 `if (k === 'loopScope') continue`，否则 `loopScope.loopNode` 反向引用
 *    其父循环（父 template.body 又含本节点）构成环 → RangeError 爆栈。
 *
 * ⚠️ inline-loop 修正：非 inline 的 LoopNode，其 `template.body` 在独立的
 *    `components/{Name}Template.tsx` 文件里 emit（由 assembleComponentTemplate 走
 *    `ext.body[]` 收集），**不属于当前文件**。只有 `loop.inline===true` 时
 *    template.body 才在当前文件内联 emit（emitLoop inline 分支）。故 walker 只对
 *    inline 循环递归 template.body——与 `collectLoopRefs` 的 inline 判定一致，
 *    否则会把模板文件的节点 id 错挂到父文件（重复计数）。
 */

import type {
  BuildNode,
  LoopNode,
  RegularNode,
  ComponentNode,
  HtmlNode,
} from '../core/node-types'
import type { FileUnit } from './state-builder'
import type { PendingConstDecl } from './tree-finalizer'

/**
 * 从 BuildNode 子树收集 A2UI 基础 id（ComponentNode/HtmlNode 的 `id`）。
 * 只收 node.id（emit 时产 `id="..."` 的来源），不收 BindingValue.nodeId（来源标记，非 DOM id）。
 */
export function collectNodeIdsFromTree(node: BuildNode | null | undefined, ids: Set<string>): void {
  if (!node || typeof node !== 'object') return

  switch (node.kind) {
    case 'component':
    case 'html': {
      const n = node as ComponentNode | HtmlNode
      if (n.id) ids.add(n.id)

      // wrapper（如 Carousel 给 div 子节点包 CarouselItem）在当前文件 emit，含 id → 收集
      if (n.wrapper) collectNodeIdsFromTree(n.wrapper, ids)

      // props 值中可能内嵌 slotNode / renderFn / BuildNode（resolveIcon 产物、
      // TableFilter 组件、baked Menu 子树等），它们在当前文件 emit → 走 value walker
      if (n.props) {
        for (const v of Object.values(n.props)) collectNodeIdsFromValue(v, ids)
      }

      // children：数组 / LoopNode（不在数组中）/ null
      const ch = n.children as RegularNode[] | LoopNode | null | undefined
      if (ch && typeof ch === 'object') {
        if ((ch as LoopNode).kind === 'loop') {
          collectNodeIdsFromLoop(ch as LoopNode, ids)
        } else if (Array.isArray(ch)) {
          for (const c of ch) collectNodeIdsFromTree(c, ids)
        }
      }
      return
    }

    case 'text':
      // TextNode 无 id；value 是 string/binding/computed，不收（BindingValue.nodeId 是来源标记，非 DOM id）
      return

    case 'extract': {
      // ExtractNode 是跨文件抽取引用：body 在独立文件 emit（assembleModuleFile /
      // assembleComponentTemplate 走 ext.body[] 收集），**不属于当前文件** → 不递归 body。
      // 但 refProps 在引用处（当前文件）作为 `<Module {...refProps} />` 的 prop 值 emit
      // （如 slotNode 子树）→ 走 value walker。
      const refProps = (node as any).refProps as Record<string, unknown> | undefined
      if (refProps) {
        for (const v of Object.values(refProps)) collectNodeIdsFromValue(v, ids)
      }
      return
    }

    case 'loop':
      // 顶层 LoopNode（直接作为 roots 传入时，如 ext.body 含循环）
      collectNodeIdsFromLoop(node as LoopNode, ids)
      return
  }
}

/**
 * 处理 LoopNode：仅 inline 循环才在当前文件内联 emit template.body（emitLoop inline 分支）；
 * 非 inline 循环的 body 在独立 components/ 文件 emit → 跳过（由该模板文件自己收集）。
 * loop.data 是 BindingValue/VarRefValue，无 node id → 不走。
 */
function collectNodeIdsFromLoop(loop: LoopNode, ids: Set<string>): void {
  if (loop.inline) {
    // inline：template.body 在当前文件 map 回调里内联渲染 → 收集
    for (const c of loop.template.body) collectNodeIdsFromTree(c, ids)
  }
  // 非 inline：template 抽离到 components/{Name}Template.tsx，body 不在当前文件 → 跳过
}

/**
 * 从 PropValue / const 值收集内嵌 BuildNode 子树的 id。
 * 分发顺序与 jsx-emitter `emitValue` / file-assembler `serializeForConstValue` 对齐：
 *   原语 → 数组 → BuildNode(kind) → PropValue(type) → 普通对象（跳过 loopScope）。
 */
export function collectNodeIdsFromValue(value: unknown, ids: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value !== 'object') return // string/number/boolean

  if (Array.isArray(value)) {
    for (const item of value) collectNodeIdsFromValue(item, ids)
    return
  }

  const v = value as any

  // BuildNode（kind 字段）→ 节点子树（component/html/text/extract/loop 作 prop 值 / const 值）
  // 须在 PropValue(type) 之前判：BuildNode 也有 __node brand，但靠 kind 区分。
  if (typeof v.kind === 'string') {
    collectNodeIdsFromTree(v as BuildNode, ids)
    return
  }

  // PropValue（type 字段）分发
  switch (v.type) {
    case 'slotNode':
      // slotNode.node 是子树，在当前文件经 emitNode emit → 收集
      collectNodeIdsFromTree(v.node as BuildNode, ids)
      return
    case 'renderFn':
      // renderFn body 在当前文件内联 emit（render 函数体）→ 收集
      if (Array.isArray(v.body)) {
        for (const c of v.body) collectNodeIdsFromTree(c as BuildNode, ids)
      } else {
        collectNodeIdsFromTree(v.body as BuildNode, ids)
      }
      return
    case 'computed':
      // containsJSX computed 的结果已被 state-builder 物化进 FileUnit
      // jsxLiteralConsts/enrichmentConsts，由 collectFileNodeIds 单独走 const 值收集；
      // 此处遇到的 ComputedValue 对象只含 transform 闭包，无可递归的已物化子树 → 跳过。
      return
    case 'binding':
    case 'varRef':
    case 'rawExpr':
    case 'literal':
      // 无内嵌 BuildNode 子树 → 跳过
      return
    default:
      // 无 kind/type 的普通对象 → 递归字段（如列定义对象里的 filter.component）
      // ⚠️ 跳过 loopScope：防爆栈（硬约束 #6）
      for (const [k, item] of Object.entries(v)) {
        if (k === 'loopScope') continue
        collectNodeIdsFromValue(item, ids)
      }
      return
  }
}

/**
 * 按文件收集 emitted 的基础 id——复刻 file-generator#augmentStyleFromConsts 的
 * 「rootTree + 各类 consts」遍历结构（同源 walker 才能覆盖所有在当前文件 emit 的节点）：
 *   - roots：本文件 emit 的树（main=draft.rootTree；module/template=ext.body）
 *   - fileUnit.jsxLiteralConsts / enrichmentConsts（containsJSX 物化结果，含 BuildNode）
 *   - moduleTopConsts（propRoute 提升的 module-top const，含 BuildNode 如 columns/render fn）
 *   - componentInternalConsts（useState 声明；值为 varRef/literal，无 id——no-op，保留以对齐结构）
 *
 * 返回去重后的 id 列表（保持 Set 插入序）。
 */
export function collectFileNodeIds(opts: {
  roots: BuildNode[]
  fileUnit?: FileUnit
  moduleTopConsts?: PendingConstDecl[]
  componentInternalConsts?: PendingConstDecl[]
}): string[] {
  const ids = new Set<string>()

  for (const root of opts.roots) collectNodeIdsFromTree(root, ids)

  const unit = opts.fileUnit
  if (unit) {
    for (const jlc of unit.jsxLiteralConsts) collectNodeIdsFromValue(jlc.value, ids)
    for (const ec of unit.enrichmentConsts) collectNodeIdsFromValue(ec.value, ids)
  }

  for (const decl of opts.moduleTopConsts ?? []) {
    collectNodeIdsFromValue(decl.value, ids)
  }
  // componentInternalConsts：useState 初始值（varRef/literal），无 BuildNode id；
  // 走一遍是无害 no-op（value walker 早退），保留以对齐 #augmentStyleFromConsts 的字段全集。
  for (const decl of opts.componentInternalConsts ?? []) {
    collectNodeIdsFromValue(decl.value, ids)
  }

  return [...ids]
}
