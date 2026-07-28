/**
 * node-types — BuildNode 联合类型及各节点接口
 *
 * 节点体系（与值类体系正交）：
 *   RegularNode → ComponentNode / HtmlNode / TextNode / ExtractNode（可在数组中）
 *   BuildNode    → RegularNode | LoopNode（所有节点）
 *
 * 从 BuildTrees 开始节点树就是 typed nodes。
 * 管线渐进填充，不存在 A2UINode 中间层。
 */

import type { PropValue, BindingValue, ComputedValue, ImportSpec, ExtractRoute, VarRefValue } from './valueTypes'

// ─── 节点类型层级 ───

/** 常规节点：可出现在 children 数组中 */
export type RegularNode = ComponentNode | HtmlNode | TextNode | ExtractNode

/** 所有节点（含直接挂在 children 位置的 LoopNode） */
export type BuildNode = RegularNode | LoopNode

// ─── ComponentNode ───

export interface ComponentNode {
  kind: 'component'

  /** A2UI element id（用于 BindingValue.nodeId、生成 className 等） */
  id?: string

  /** A2UI 原始组件名 */
  component: string

  /** 节点 props（值类体系） */
  props: Record<string, PropValue>

  /** 子节点：常规节点数组 / LoopNode（不在数组中）/ null */
  children?: RegularNode[] | LoopNode | null

  /** 目标组件 tag（NodeMapper 后填充） */
  tag?: string

  /** 目标组件 import（NodeMapper 后填充） */
  import?: ImportSpec

  /** 渲染外壳（NodeMapper 后填充） */
  wrapper?: BuildNode

  /** 自闭合标签（NodeMapper 后填充） */
  selfClosing?: boolean

  /**
   * 非 path 绑定的字面量 prop 的出口声明。
   * key=prop key, value=ExtractRoute。
   * 未声明默认 inline（与 propRoute 不存在等价）。
   * path 绑定走 BindingValue.route，不进入此字段。
   */
  propRoute?: Record<string, ExtractRoute>

  /** 是否已经过 transform（防二次） */
  _resolved?: boolean

  /** 作用域（循环或 render fn 内部时为当前作用域的引用） */
  loopScope?: Scope
}

// ─── HtmlNode ───

export interface HtmlNode {
  kind: 'html'
  id?: string
  tag: string
  props: Record<string, PropValue>
  /** 子节点：常规节点数组 / LoopNode（不在数组中）/ null */
  children?: RegularNode[] | LoopNode | null
  /** 包裹层（如 Carousel 给 div 子节点包 CarouselItem）；jsxEmitter 渲染、importCollector 收集 */
  wrapper?: BuildNode
  /** 是否已经过 transform（防二次） */
  _resolved?: boolean

  /** 作用域（循环或 render fn 内部时为当前作用域的引用） */
  loopScope?: Scope
}

// ─── TextNode ───

export interface TextNode {
  kind: 'text'
  value: string | BindingValue | ComputedValue
  _resolved?: boolean
  /** 作用域 */
  loopScope?: Scope
}

// ─── ExtractNode（跨文件抽取引用） ───

export interface ExtractNode {
  kind: 'extract'

  /** 抽取组件名 — 决定文件名、tag、import 路径 */
  componentName: string

  /** 输出路由 → modules/ 或 components/ */
  purpose: 'module' | 'component'

  /** 被抽取的子树（常规节点，不含 LoopNode） */
  body: RegularNode[]

  /**
   * 引用端传入的 props（仅循环模板抽取时用，如 { data: dataBinding }）。
   * 模块抽取（purpose: 'module'）不设此字段。
   */
  refProps?: Record<string, PropValue>

  /** 覆盖默认文件名 */
  fileName?: string

  /** 是否已处理（与 ComponentNode/HtmlNode/TextNode 一致） */
  _resolved?: boolean

  /** 循环作用域（在循环内部时为当前循环的 LoopScope 引用） */
  loopScope?: Scope
}

/**
 * 节点所在的循环作用域链。
 * 不在循环中的节点不挂此字段。
 *
 * 用于：
 *   - 数据端：嵌套 enrichment
 *   - 代码端：相对路径 binding 的正确作用域引用
 *
 * 2026-07-17 扩展：Scope = LoopScope | RenderFnScope
 *   RenderFnScope 用于 render fn body 内的作用域解析
 */

/** 作用域：LoopScope（循环） | RenderFnScope（render 函数） */
export type Scope = LoopScope | RenderFnScope

export interface LoopScope {
  /** 节点直接所属的 LoopNode */
  loopNode: LoopNode

  /** 外层作用域链（统一为 Scope，可指向 RenderFnScope） */
  parent?: Scope
}

export interface RenderFnScope {
  /** 参数名 → 数据源 binding（来自 params[].dataSource） */
  paramBindings: Record<string, BindingValue>

  /** 外层作用域链 */
  parent?: Scope
}

// ─── LoopNode（循环节点） ───

export interface LoopNode {
  kind: 'loop'

  /** 循环数据源（BuildTrees 阶段是 BindingValue；tree-finalizer 阶段可被替换为 VarRefValue 指向 enrichment const） */
  data: BindingValue | VarRefValue

  /** 模板节点 → 抽出为 components/ 中的 ExtractNode */
  template: ExtractNode

  /** 循环参数签名，默认 '(item, idx)' */
  params?: string

  /** 循环变量名，默认 'item' */
  loopVar?: string

  route?: ExtractRoute

  /** 循环作用域（内层循环时指向外层） */
  loopScope?: Scope
}
