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

import { Step } from '../core/step-base'
import type { ComponentRegistry } from '../core/component-registry'
import type {
  TransformContext,
  TransformResult,
} from '../core/component-mapping'
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
} from '../core/node-types'
import type { PipelineContext, MappedPage } from '../pipeline/pipeline-context'
import { resolveIcon } from '../core/icon-collection'
import type { BindingValue } from '../core/value-types'

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
    ctx.mappedPages = []
    for (const bp of ctx.builtPages) {
      ctx.currentPage = bp.pageName   // 诊断：出错时 pipeline-engine 能定位到页
      try {
        const mapped = this.#mapPage(bp)
        ctx.mappedPages.push(mapped)
      } catch (err: any) {
        // 单页隔离：一页失败不影响其他页，错误汇总到 ctx.errors 由 GenerateReport 输出
        const msg = err?.message ?? String(err)
        ctx.errors.push({ step: 'NodeMapper', page: bp.pageName, message: msg, stack: err?.stack })
        console.warn(`  [warn] NodeMapper: 页 "${bp.pageName}" 处理失败，跳过: ${msg}`)
      }
    }
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
      eventMutatedPaths: bp.eventMutatedPaths ?? new Set(),
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
    // ── 未注册组件（大写 = A2UI 组件）→ 注释占位 ──
    // 小写开头走 registry 的 HTML 标签兜底（原生 DOM，非“组件”），不占位。
    if (!this.#registry.has(node.component) && /^[A-Z]/.test(node.component)) {
      const text = `未映射组件: ${node.component}${node.id ? ` (id=${node.id})` : ''}`
      console.warn(`  [warn] NodeMapper: ${text}`)
      return this.#commentPlaceholder(node, text)
    }

    // transform 直接用 ctx（resolveAbsoluteStateValue 仅绝对路径，无节点级覆盖）
    let result: TransformResult | null = null
    try {
      result = this.#registry.transform(node.component, node, ctx)
    } catch (err: any) {
      // transform 抛错（映射文件 bug）→ 注释占位 + warn，不再静默吞
      const text = `组件 transform 失败: ${node.component}${node.id ? ` (id=${node.id})` : ''}: ${err?.message ?? err}`
      console.warn(`  [warn] NodeMapper: ${text}`)
      return this.#commentPlaceholder(node, text)
    }

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
        classNameProp: result.classNameProp ?? node.classNameProp,
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

  /** 构造注释占位节点：标签输出为 JSX 注释，import 由 import-collector 注释化 */
  #commentPlaceholder(node: ComponentNode, text: string): ComponentNode {
    return {
      __node: true,
      kind: 'component',
      component: node.component,
      tag: node.component,
      id: node.id,
      import: `@/components/${node.component}`,
      props: {},
      children: null,
      selfClosing: true,
      commentPlaceholder: this.#sanitizeCommentText(text),
    }
  }

  /** 注释文本安全化：防止 JSX 注释结束符被提前闭合、换行破坏单行注释 */
  #sanitizeCommentText(text: string): string {
    return String(text ?? '').replace(/\*\//g, '* /').replace(/[\r\n]/g, ' ').slice(0, 160)
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
