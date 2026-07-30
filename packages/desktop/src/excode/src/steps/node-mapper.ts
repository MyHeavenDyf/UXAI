/**
 * Step 4: NodeMapper — 节点变换（纯形状变换，不收集数据）
 *
 * 核心流程：
 *   BuildTrees（全节点 _resolved: false）
 *     ↓
 *   walkTree 深度递归（不再传任何 collector）
 *     ├─ ComponentNode → registry.transform → 合并字段 → delete _resolved
 *     ├─ HtmlNode → delete _resolved
 *     ├─ TextNode → 单纯标记已处理
 *     ├─ ExtractNode → body.map(walkTree)
 *     └─ LoopNode → 简单递归 template.body
 *
 * 不再维护 DataCollector / DataManifest。
 * state-builder 阶段自行走树消费 binding/computed。
 *
 * TransformContext 提供 resolveNode 供 transform 内调用子树展开。
 */

import { Step } from '../core/step'
import type { ComponentRegistry } from '../core/componentRegistry'
import type {
  TransformContext,
  TransformResult,
} from '../core/componentMapping'
import type {
  BuildNode,
  ComponentNode,
  HtmlNode,
  TextNode,
  ExtractNode,
  LoopNode,
  RegularNode,
  LoopScope,
  RenderFnScope,
  Scope,
} from '../core/nodeTypes'
import type { PipelineContext, MappedPage } from '../pipeline/pipelineContext'
import { resolveIcon } from '../core/iconCollection'
import type { BindingValue } from '../core/valueTypes'

// ─── 路径取值辅助 ───

function getValueFromState(state: Record<string, any>, path: string): any {
  if (!path || !state) return undefined
  const segments = path.replace(/^\//, '').split('/').filter(Boolean)
  let current: any = state
  for (const seg of segments) {
    if (current == null) return undefined
    current = current[seg]
  }
  return current
}

// ─── NodeMapper ───

export class NodeMapper extends Step {
  #registry!: ComponentRegistry

  async execute(ctx: PipelineContext): Promise<void> {
    this.#registry = ctx.registry
    ctx.mappedPages = ctx.builtPages.map(bp => this.#mapPage(bp))
  }

  #mapPage(bp: any): MappedPage {
    const tctx = this.#createTransformContext(bp.iconNameMap, bp.state ?? {})

    const rootTree = this.#walkTree(bp.rootTree, tctx)
    const extracts = (bp.extracts || []).map((ext: any) => ({
      ...ext,
      body: ext.body.map((c: any) => this.#walkTree(c, tctx)),
    }))

    return {
      pageName: bp.pageName,
      state: bp.state,
      rootTree,
      extracts,
      iconNameMap: bp.iconNameMap,
    }
  }

  // ── TransformContext ──

  #createTransformContext(
    iconNameMap: Record<string, string>,
    state: Record<string, any>
  ): TransformContext {
    const self = this
    const ctx: TransformContext = {} as any

    ctx.state = state

    ctx.resolveIcon = (iconName: string, iconProps?: Record<string, any>) =>
      resolveIcon(iconName, iconNameMap, iconProps)

    ctx.resolveNode = (node: BuildNode) =>
      self.#walkTree(node, ctx as any)

    ctx.resolveAbsoluteStateValue = (path: string) => {
      if (!path || !path.startsWith('/')) return undefined  // 仅绝对路径
      return getValueFromState(state, path)
    }

    return ctx
  }

  // ── 主 walkTree 核心递归 ──

  #walkTree(
    node: BuildNode,
    ctx: TransformContext,
  ): BuildNode {
    if (!node) return null as any
    if ((node as any)._resolved !== false) return node

    switch (node.kind) {
      case 'component': return this.#resolveComponent(node, ctx)
      case 'html': return this.#resolveHtml(node, ctx)
      case 'text': return this.#resolveText(node)
      case 'extract': return this.#resolveExtract(node, ctx)
    }
    return node
  }

  #resolveComponent(
    node: ComponentNode,
    ctx: TransformContext,
  ): ComponentNode {
    // transform 直接用 ctx（resolveAbsoluteStateValue 仅绝对路径，无节点级覆盖）
    let result: TransformResult | null = null
    try {
      result = this.#registry.transform(node.component, node, ctx)
    } catch { /* noop */ }

    let merged: ComponentNode
    if (result) {
      merged = {
        ...node,
        tag: result.tag ?? node.tag,
        import: result.import ?? node.import,
        props: result.props !== undefined ? result.props : node.props,
        // transform 返回 children → 直接替换（数组/LoopNode）；null → 显式清空；undefined → 保留原始
        children: result.children !== undefined ? result.children : node.children,
        wrapper: result.wrapper ?? node.wrapper,
        selfClosing: result.selfClosing,
        propRoute: result.propRoute ?? node.propRoute,
      }
    } else {
      merged = { ...node }
    }
    delete (merged as any)._resolved

    // resolveChildren 只对合法 children（数组或 LoopNode）做深度递归
    if (merged.children !== null && merged.children !== undefined) {
      merged.children = this.#resolveChildren(merged.children, ctx)
    }
    return merged
  }

  #resolveHtml(
    node: HtmlNode,
    ctx: TransformContext,
  ): HtmlNode {
    delete (node as any)._resolved
    node.children = this.#resolveChildren(
      node.children ?? null,
      ctx,
    )
    return node
  }

  #resolveText(node: TextNode): TextNode {
    delete (node as any)._resolved
    return node
  }

  #resolveExtract(
    node: ExtractNode,
    ctx: TransformContext,
  ): ExtractNode {
    delete (node as any)._resolved
    node.body = node.body.map(c =>
      this.#walkTree(c, ctx)
    ) as RegularNode[]
    return node
  }

  // ── children ──

  #resolveChildren(
    children: RegularNode[] | LoopNode | null,
    ctx: TransformContext,
  ): RegularNode[] | LoopNode | null {
    if (!children) return null

    if ((children as any).kind === 'loop') {
      return this.#resolveLoopNode(children as LoopNode, ctx)
    }

    return (children as RegularNode[]).map(c => {
      if ((c as any)._resolved === false) return this.#walkTree(c, ctx)
      return c
    }) as RegularNode[]
  }

  // ── LoopNode：简单递归 template.body，不创建任何 collector ──

  #resolveLoopNode(
    loop: LoopNode,
    ctx: TransformContext,
  ): LoopNode {
    const resolvedBody = loop.template.body.map(c =>
      this.#walkTree(c, ctx)
    )

    return {
      ...loop,
      template: { ...loop.template, body: resolvedBody as RegularNode[] },
    }
  }
}
