/**
 * value-types — PropValue 联合类型及各值类接口
 *
 * = 值类体系类型（type 字段判别）：
 *   binding / computed / varRef / rawExpr / renderFn / slotNode
 * = 常规 JS 数据类型：
 *   string / number / boolean / null + 数组 + 嵌套对象
 */

import type { BuildNode } from './nodeTypes'

// ─── ExtractRoute（三路由） ───

export type ExtractRoute = 'inline' | 'module-top' | 'component-internal'

// ─── ImportSpec ───

export type ImportSpec = string | { source: string; named?: boolean }
// string                  → import Tag from 'source'
// { source, named: true } → import { Tag } from 'source'

// ─── PropValue 联合类型 ───

export type PropValue =
  | BindingValue
  | LiteralValue
  | ComputedValue
  | VarRefValue
  | RawExprValue
  | RenderFnValue
  | SlotNodeValue
  | string
  | number
  | boolean
  | null
  | PropValue[]
  | { [key: string]: PropValue }

// ─── UseStateMarker（useState 包裹标记） ───

/**
 * 标记 value 需要在组件函数体中生成 useState 包裹。
 * 用于 BindingValue / LiteralValue / ComputedValue 等 value 类型。
 */
export interface UseStateMarker {
  /**
   * 可选：目标事件 prop 名（如 'onChange'、'onInput'、'onCheckedChange'）。
   * 序列化时直接作为 prop key 使用，不再拼前缀。
   * 不设则不生成事件处理 prop，只生成 useState 包裹。
   */
  event?: string

  /**
   * 可选：从事件对象提取新值的字符串模板函数（接收 setter 名）。
   * 例：s => `${s}(e.target.value)`
   */
  extractor?: (setter: string) => string
}

// ─── LiteralValue（字面量值） ───

/**
 * 字面量值（与 BindingValue 解耦——纯字面，无 path 语义）。
 *
 * - 仅作为 prop value 时有 IR 形式存在
 * - 默认不参与 state 数据处理（state.js 不入表）
 * - useState 标记存在时，组件函数体内生成 useState 包裹
 */
export interface LiteralValue {
  type: 'literal'

  /** 字面量值 */
  value: any

  /** 可选：触发 useState 包裹 */
  useState?: UseStateMarker
}

// ─── BindingValue（路径绑定） ───

export interface BindingValue {
  type: 'binding'
  /** A2UI 原始路径：'/aaa'（绝对）或 'name'（相对） */
  path: string
  /** 路径类型 */
  pathType: 'absolute' | 'relative'
  /** 编译后路径：'/b/1/c' → 'b[1].c'，相对路径直接存 */
  accessPath: string
  /** 编译期从 state 取一次的快照值（absolute 按 accessPath 取；relative 按当前循环数据源取首项）；路径未命中写 null */
  stateValue?: any
  /** 来源节点 ID（BuildTrees 构建时即填） */
  nodeId?: string
  /** 来源组件名（BuildTrees 构建时即填，用于去重） */
  componentName?: string
  /** 来源 prop key（BuildTrees 构建时即填，用于去重） */
  propKey?: string
  /** 路由（默认由 bindMode 推断） */
  route?: ExtractRoute
  /** 可选：触发 useState 包裹（path 双绑场景） */
  useState?: UseStateMarker
}

// ─── ComputedValue（BindingValue 超集 + 数据转换） ───

export interface ComputedTransformCtx {
  /** 原始 state（绝对路径直接用） */
  rawState: Record<string, any>
  /**
   * 通用路径解析：调用者不关心 path 是绝对还是相对。
   *   绝对路径 /xxx → rawState 直取
   *   相对路径 xxx  → 沿当前节点 LoopScope 链向上找首个 absolute dataBinding 作根 → 按段解析
   */
  resolveValueFromPath: (path: string) => any
  /** 图标名称 → BuildNode（用于 containsJSX 的 transform 中 resolve 图标） */
  resolveIcon: (iconName: string, iconProps?: Record<string, any>) => any
}

export interface ComputedValue extends Omit<BindingValue, 'type'> {
  type: 'computed'
  /** 数据转换函数（编译期执行，不产运行时代码） */
  transform: (rawValue: any, ctx?: ComputedTransformCtx) => any
  /** 转换结果是否包含 JSX */
  containsJSX: boolean
  /** 命名策略（生成新 state key 或 const 名） */
  identResolver?: (ctx: IdentContext) => string
}

export interface IdentContext {
  defaultName: string
  sourceType: 'computed' | 'slotNode' | 'renderFn' | 'loop'
  componentName?: string
  propKey?: string
  nodeId?: string
}

// ─── VarRefValue（编译期常量引用） ───

export interface VarRefValue {
  type: 'varRef'
  /** 变量名，序列化为 {name} */
  name: string
}

// ─── RawExprValue（逃生舱） ───

export interface RawExprValue {
  type: 'rawExpr'
  /** 原始 JS 表达式 */
  value: string
}

// ─── RenderFnParam（渲染函数形参声明） ───

export interface RenderFnParam {
  /** 形参名（用于 JS 函数签名 & emit 前缀） */
  name: string

  /**
   * 可选：此 param 是否为"数据源参数"。
   * 提供 binding 时：
   *   1. state-builder 建立 RenderFnScope，body 内相对 binding 沿此 binding 解析
   *   2. jsx-emitter 在函数体顶部 `const { ${fields} } = ${dataAccessor}` 解构后，以裸名 `{X}` emit
   * 不提供时：仅作为普通运行时 param 透传
   */
  dataSource?: BindingValue

  /**
   * 可选：数据在 param 上的嵌套字段（决定解构源）。
   * 例：eview-react Table render(cellValue, rowData, options, row)，当前行数据在 `row.rawData`，
   * 则 dataSource 参数 name='row' + dataField='rawData'，解构源为 `row.rawData`
   * （`const { f1, f2 } = row.rawData`），body 内相对 binding 仍裸 `{f1}`。
   * 不提供时：解构源 = name（如 `rowData`）。
   */
  dataField?: string
}

// ─── RenderFnValue（渲染函数） ───

export interface RenderFnValue {
  type: 'renderFn'

  /** 形参声明（结构化，保留顺序） */
  params: RenderFnParam[]

  /** 渲染函数体 */
  body: BuildNode | BuildNode[]

  route?: ExtractRoute
}

// ─── SlotNodeValue（Slot 子树） ───

export interface SlotNodeValue {
  type: 'slotNode'
  node: BuildNode
  route?: ExtractRoute
}
