/**
 * value-types — PropValue 联合类型及各值类接口
 *
 * = 值类体系类型（type 字段判别）：
 *   binding / computed / varRef / rawExpr / renderFn / slotNode
 * = 常规 JS 数据类型：
 *   string / number / boolean / null + 数组 + 嵌套对象
 */

import type { BuildNode } from './node-types'

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
  | ActionValue
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
  __node: true,
  type: 'literal'

  /** 字面量值 */
  value: any

  /** 可选：触发 useState 包裹 */
  useState?: UseStateMarker
}

// ─── BindingValue（路径绑定） ───

export interface BindingValue {
  __node: true,
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
  /**
   * 共享响应式标记（state-builder 打标）：
   * true = 该 path 被事件 Action 改写（在 eventMutatedPaths 集合中），
   * 需走页级共享 store（useSharedState）而非 initialState 快照/局部 useState。
   * 共享 path 按协议只在 state 顶层。
   */
  shared?: boolean
}

// ─── ComputedValue（BindingValue 超集 + 数据转换） ───

/**
 * transform 旁路 store：transform 往此写需改写的所属节点字段，state-builder 在 transform
 * 跑完后把字段应用到 owning node。opt-in——不写则节点不变，既有 mapping 行为零影响。
 *
 * transform 的 return 主路照走（进 const/state），override 是与之正交的纯旁路，二者互不干扰。
 * 支持 tag/import（改 component）+ renameProps/deleteProps（改 props）；由 applyOverrideToNode
 * 应用到 owning node（deleteProps 先于 renameProps，避免改名后被误删）。绝对路径（调用点 1，
 * consumeValue）+ 相对路径（调用点 2，applyScopedCV 透传 ownerNode/store）两处都已接通。
 */
export interface OverrideStore {
  /** 覆盖所属节点的 tag（组件名，如 DropDown → PopUpMenu） */
  tag?: string
  /** 覆盖所属节点的 import（模块路径） */
  import?: string
  /** 改名节点 prop 键（如 data → options）。oldKey 必须已存在才改；应用在 deleteProps 之后 */
  renameProps?: Record<string, string>
  /** 删除节点 prop 键（如 PopUpMenu 丢弃 trigger / DropDown 专属 placement）。
   *  应用在 renameProps 之前，避免改名后被误删 */
  deleteProps?: string[]
}

export interface ComputedTransformCtx {
  /** 原始 state（绝对路径直接用） */
  rawState: Record<string, any>
  /**
   * 当前项（循环中的 item）：relative path 从此项按段解析。
   * enrichment（applyScopedCV）递归内更新为当前 obj；absolute computed 不设（transform 内 path 都 absolute）。
   */
  currentItem?: any
  /**
   * 通用路径解析：调用者不关心 path 是绝对还是相对。
   *   绝对路径 /xxx → rawState 直取
   *   相对路径 xxx  → 从 currentItem（当前项）按段解析
   */
  resolveValueFromPath: (path: string) => any
  /** 图标名称 → BuildNode（用于 containsJSX 的 transform 中 resolve 图标） */
  resolveIcon: (iconName: string, iconProps?: Record<string, any>) => any
  /**
   * 旁路 store：transform 往此写需改写的所属节点字段（tag/import），state-builder 在
   * transform 跑完后应用到 owning node。opt-in，不写则节点不变。
   * 由 state-builder 在每次调 transform 前注入一个空对象，transform 内 `ctx.override.tag = ...` 赋值。
   */
  override?: OverrideStore
}

export interface ComputedValue extends Omit<BindingValue, 'type'> {
  __node: true,
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
  __node: true,
  type: 'varRef'
  /** 变量名，序列化为 {name} */
  name: string
  /**
   * 仅 loop.data 的 varRef 设置（routeLoopNode）：标识数据源是 absolute（顶层 state/const，
   * 嵌套循环时外层不该 destructure）还是 relative（外层 item 字段，外层需 destructure）。
   * 供 collectRelativeFields 区分；其它 varRef（useState 等）不设。
   */
  pathType?: 'absolute' | 'relative'
}

// ─── RawExprValue（逃生舱） ───

export interface RawExprValue {
  __node: true,
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
  __node: true,
  type: 'renderFn'

  /** 形参声明（结构化，保留顺序） */
  params: RenderFnParam[]

  /** 渲染函数体 */
  body: BuildNode | BuildNode[]

  route?: ExtractRoute
}

// ─── SlotNodeValue（Slot 子树） ───

export interface SlotNodeValue {
  __node: true,
  type: 'slotNode'
  node: BuildNode
  route?: ExtractRoute
}

// ─── ActionValue（事件动作：setState 写共享 state） ───

/**
 * 事件 Action（Button.onClick / Drawer.onClose / Modal.onClose 等）。
 *
 * A2UI schema：`{ action: "setState", args: { path, value } }`
 * → 事件触发时把 value 写入 state 的 path（共享 store，因 path 被多处读+写）。
 *
 * 由 build-trees #processValue 识别 `{action,args}` 形状产出（event = prop key）；
 * mapping/transform 透传到 outputProps；
 * jsx-emitter 按 type:'action' 分发为 `() => setSharedState(key, value)`。
 *
 * value 暂只字面量（true/false/字符串/数字）；toggle/表达式/DataBinding 后续扩展。
 */
export interface ActionValue {
  __node: true,
  type: 'action'
  /** 事件名（prop key，如 'onClick' / 'onClose'） */
  event: string
  /** 动作类型（目前仅 'setState'，留扩展位） */
  action: 'setState'
  /** 写入的 state path（JSON pointer，如 '/isDetailOpen'；按协议顶层） */
  path: string
  /** 写入值（字面量） */
  value: any
}
