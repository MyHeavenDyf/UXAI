/**
 * Node — 节点工厂
 *
 * 统一通过 Node.* 工厂构造所有节点实例。
 * 与 Value.* 工厂平行，负责节点体系（kind）的构造。
 *
 * 映射文件中的用法：
 *
 *   import { Node } from '../../../src/core/node'
 *   Node.component({ tag: 'span', props: { className: 'text-sm' } })
 *   Node.text({ value: 'hello' })
 *   Node.html({ tag: 'div', props: { className: 'flex' } })
 */

import type {
  RegularNode, ComponentNode, HtmlNode, TextNode, ExtractNode, LoopNode,
} from './nodeTypes'
import type {
  BindingValue, ComputedValue, PropValue, ImportSpec, ExtractRoute, VarRefValue,
} from './valueTypes'

export const Node = {
  /** 组件节点 — 对应 mapped 的 eview-react 或自定义组件 */
  component(opts: {
    component?: string
    tag: string
    props: Record<string, PropValue>
    id?: string
    children?: RegularNode[] | LoopNode | null
    import?: ImportSpec
    wrapper?: import('./nodeTypes').BuildNode
    selfClosing?: boolean
    propRoute?: Record<string, ExtractRoute>
  }): ComponentNode {
    return {
      kind: 'component',
      ...opts,
      component: opts.component ?? opts.tag,
    }
  },

  /** HTML 节点 — 对应原生 DOM 标签 */
  html(opts: {
    tag: string
    props: Record<string, PropValue>
    id?: string
    children?: RegularNode[] | LoopNode | null
  }): HtmlNode {
    return { kind: 'html', ...opts }
  },

  /** 文本节点 — children 中的纯文本或绑定值 */
  text(opts: {
    value: string | BindingValue | ComputedValue
  }): TextNode {
    return { kind: 'text', value: opts.value }
  },

  /** 循环节点 */
  loop(opts: {
    data: BindingValue | VarRefValue
    template: ExtractNode
    params?: string
    loopVar?: string
    route?: ExtractRoute
  }): LoopNode {
    return { kind: 'loop', ...opts }
  },
}
