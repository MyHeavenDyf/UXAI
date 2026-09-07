/**
 * Value — 值类工厂
 *
 * 统一通过 Value.* 工厂构造所有值类实例。
 * 映射文件中直接 import 使用：
 *
 *   import { Value } from '../../../api/src/core/value'
 *   Value.binding({ path: '/xxx', pathType: 'absolute', ... })
 */

import type { BuildNode } from './nodeTypes'
import type {
  BindingValue,
  ComputedValue,
  ComputedTransformCtx,
  LiteralValue,
  RenderFnParam,
  VarRefValue,
  RawExprValue,
  RenderFnValue,
  SlotNodeValue,
  ExtractRoute,
  UseStateMarker,
} from './valueTypes'

export const Value = {
  /** 路径绑定（基础结构，由 BuildTrees / transform 构造） */
  binding(opts: {
    path: string
    pathType: 'absolute' | 'relative'
    accessPath: string
    stateValue?: any
    nodeId?: string
    componentName?: string
    propKey?: string
    route?: ExtractRoute
    /** 可选 useState 包裹标记 */
    useState?: UseStateMarker
  }): BindingValue {
    return { type: 'binding', ...opts }
  },

  /** 数据转换（BindingValue 超集，由 transform 构造） */
  computed(opts: {
    path: string
    pathType: 'absolute' | 'relative'
    accessPath: string
    stateValue?: any
    nodeId?: string
    componentName?: string
    propKey?: string
    route?: ExtractRoute
    /** 可选 useState 包裹标记 */
    useState?: UseStateMarker
    transform: (rawValue: any, ctx?: ComputedTransformCtx) => any
    containsJSX: boolean
    identResolver?: (ctx: any) => string
  }): ComputedValue {
    return { type: 'computed', ...opts }
  },

  /** 字面量值（不参与 state.js，配合 useState 标记触发 useState 包裹） */
  literal(opts: {
    value: any
    useState?: UseStateMarker
  }): LiteralValue {
    return { type: 'literal', ...opts }
  },

  /** 编译期常量引用 */
  varRef(opts: { name: string }): VarRefValue {
    return { type: 'varRef', ...opts }
  },

  /** 原始 JS 表达式逃生舱 */
  rawExpr(opts: { value: string }): RawExprValue {
    return { type: 'rawExpr', ...opts }
  },

  /** 渲染函数（结构化 params） */
  renderFn(opts: {
    params: RenderFnParam[]
    body: BuildNode | BuildNode[]
    route?: ExtractRoute
  }): RenderFnValue {
    return { type: 'renderFn', ...opts }
  },

  /** Slot 子树 */
  slotNode(opts: {
    node: BuildNode
    route?: ExtractRoute
  }): SlotNodeValue {
    return { type: 'slotNode', ...opts }
  },
}