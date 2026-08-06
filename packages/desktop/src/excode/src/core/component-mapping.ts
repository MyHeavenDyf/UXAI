/**
 * MappingDef — 组件映射定义
 *
 * 每个 A2UI 组件对应一个 MappingDef，声明其目标组件映射和转换逻辑。
 */

import type { BuildNode, LoopNode } from './node-types'
import type {
  PropValue,
  ImportSpec,
  ExtractRoute,
} from './value-types'

// ─── TransformContext（transform 运行时注入） ───

export interface TransformContext {
  /** 页面原始 state（transform 内可读取，用于数据源 enrichment 等） */
  state: Record<string, any>

  /**
   * 递归解析子树：返回 transform 已应用的 BuildNode。
   *
   * 等价于 NodeMapper 的 walkTree 一次调用——触发子树内组件 transform 并返回已处理节点。
   * 不收集任何 binding/computed，不含 bindingReplacement。
   *
   * 适用场景：Table/Tabs 等容器组件的 transform 中需要展开子树。
   */
  resolveNode: (node: BuildNode) => BuildNode

  /** A2UI icon name → 已 resolve 的 icon BuildNode */
  resolveIcon: (iconName: string, iconProps?: Record<string, any>) => BuildNode | null

  /**
   * 按绝对路径从 state 取值（仅适合绝对路径）。
   *
   * - 绝对路径 `/xxx/yyy` → 从 state 直取 `state.xxx.yyy`
   *
   * ⚠️ 不支持相对路径。组件 transform 每个节点只跑一次，相对路径需要 per-item 解析
   * （那是 ComputedValue.transform 内 cvCtx.resolveValueFromPath 的职责）。
   * 若需处理相对路径的 DataBinding 值，请用 `Value.computed()`，在 transform 内用
   * `cvCtx.resolveValueFromPath`（绝对/相对都正确）。
   */
  resolveAbsoluteStateValue: (path: string) => any
}

// ─── TransformResult（transform 返回值） ───

export interface TransformResult {
  /** 目标组件 tag（覆盖 MappingDef.tag；不传则沿用 MappingDef.tag 或原始 component 名） */
  tag?: string

  /** 目标组件 import（覆盖 MappingDef.import） */
  import?: ImportSpec

  /** 转换后的 props（完全替换原始 props） */
  props?: Record<string, PropValue>

  /** 转换后的 children（默认 null = 透传原始 children） */
  children?: BuildNode[] | LoopNode | any[] | any | null

  /** 渲染外壳 */
  wrapper?: BuildNode

  /** 是否自闭合 */
  selfClosing?: boolean

  /**
   * prop 出口声明
   * key=prop key, value=ExtractRoute ('inline' | 'module-top' | 'component-internal')
   * 声明后 Phase B/C 会自动把字面量 prop 提升到对应位置
   */
  propRoute?: Record<string, ExtractRoute>

  /**
   * className 在产物 JSX 上的输出 key 别名（默认 'className'）。
   *
   * 某些目标组件接收的样式 prop 名不是 className 而是别名（如 inputClassName），
   * 声明后 jsx-emitter/file-assembler emit 时输出 `<别名={styles.id}>` 而非 `className={styles.id}`。
   *
   * ⚠️ props 内部 key 仍是 'className'（style-converter 读 props.className 收集样式照常），
   * 此字段只影响末端 emit 的输出 key，不影响样式收集。
   */
  classNameProp?: string
}

// ─── MappingDef ───

export interface MappingDef {
  /** 唯一必填：目标组件名 */
  tag: string

  /** 目标导入路径 */
  import?: ImportSpec

  /** 默认 prop 值（transform 前填充） */
  defaults?: Record<string, any>

  /** 自定义转换（最强大的扩展点） */
  transform?: (node: any, context: TransformContext) => TransformResult | null

  /** className 在产物 JSX 上的输出 key 别名（默认 'className'）；详见 TransformResult.classNameProp */
  classNameProp?: string
}

// ─── ComponentRegistry 步骤间传递接口 ───

export interface RegistryEntry {
  def: MappingDef
  transformFn: (node: any, ctx: TransformContext) => TransformResult | null
}