/**
 * Step 3: BuildTrees — 单次遍历构建 typed node 树
 *
 * 职责：
 *   1. 平面 elements → 嵌套 BuildNode 树
 *   2. {path} → Value.binding({ path, pathType, accessPath, nodeId })
 *   3. {componentId} → inline slot 展开为 Value.slotNode({ node })
 *   4. children = {path, componentId} → LoopDescriptor (template 抽为 ExtractNode)
 *   5. 命中 splitMeta → ExtractNode 切断子树 (purpose: 'module')
 *   6. Icon 收集（解耦到 IconCollector 模块）：
 *      a) 字面量 icon prop：构建节点时调用 collectFromNodeProps
 *      b) DataBinding icon prop：构建 BindingValue 时调用 collectFromBinding
 *      c) 防御性 state 全量递归：遍历完成后调用 collectFromState
 *   7. HTML value → TextNode 下沉（对 HTML_TEXT_ELEMENTS）
 *
 * 不做：transform 调用（NodeMapper 阶段处理）。
 */

import { Step } from '../core/step'
import { Value } from '../core/value'
import { Node } from '../core/node'
import { IconCollector } from '../core/iconCollection'
import {
  HTML_TEXT_ELEMENTS,
  HTML_VALUE_ATTRIBUTE_ELEMENTS,
  ICON_PROPS_BY_COMPONENT,
  ICON_PROPS_NESTED_IN_ARRAYS,
} from '../core/iconProps'
import { rewriteResourcePath } from '../core/resourcePath'
import type {
  BuildNode,
  ComponentNode,
  HtmlNode,
  TextNode,
  ExtractNode,
  LoopNode,
  LoopScope,
  RegularNode,
} from '../core/nodeTypes'
import type { PropValue } from '../core/valueTypes'
import type { PipelineContext } from '../pipeline/pipelineContext'
import type { BuiltPage } from '../pipeline/pipelineContext'

// ─── state path 工具（inline；后续可与 icon-collection.ts#resolvePath 合并到 core/state-path.ts） ───

/** 把 "/a/b/0/c" 或 "a/b/0/c" 归一为 segments */
function pathToSegments(path: string): string[] {
  return path.replace(/^\//, '').split('/').filter(Boolean)
}

/** 按 segments 逐级取值；找不到 → undefined */
function resolveBySegments(root: any, segments: string[]): any {
  let cur: any = root
  for (const seg of segments) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

/** 从当前的 loopStack 构建 LoopScope 链（从外到内） */
function buildLoopScope(stack: Array<{ loopNode: LoopNode }>): LoopScope | undefined {
  if (stack.length === 0) return undefined
  let scope: LoopScope | undefined
  for (let i = 0; i < stack.length; i++) {
    scope = { loopNode: stack[i].loopNode, parent: scope }
  }
  // scope 指向最内层循环，parent 链指向外层
  return scope
}

interface PageData {
  pageName: string
  a2uiDoc: { state: Record<string, any>; rootId: string; elements: any[] }
  splitMeta: Array<{ id_prefix: string; section_id: string; element_id: string }>
}

interface BuildContext {
  elements: any[]
  state: Record<string, any>
  splitMetaMap: Map<string, { section_id: string; id_prefix: string }>
  extracts: ExtractNode[]
  iconCollector: IconCollector
  /** 循环栈：每进入一个循环压栈，退出时弹栈 */
  loopStack: Array<{
    loopVar: string
    dataBinding: { path: string; pathType: 'absolute' | 'relative'; accessPath: string }
    /** 对应的 LoopNode 引用（预创建，构建完 body 后 template.body 再填充） */
    loopNode: LoopNode
  }>
}

export class BuildTrees extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    ctx.builtPages = []

    const pagesData: PageData[] = (ctx as any).pagesData || []
    for (const pageData of pagesData) {
      const built = await this.#buildPage(pageData)
      ctx.builtPages.push(built)
    }

    const totalIcons = ctx.builtPages.reduce(
      (sum, p) => sum + (p as any)._iconNameSet?.length || 0,
      0
    )
    console.log(
      `  ℹ  BuildTrees: ${ctx.builtPages.length} 个页面，共 ${totalIcons} 个 icon name 收集`
    )
  }

  async #buildPage(pageData: PageData): Promise<BuiltPage> {
    const { pageName, a2uiDoc, splitMeta } = pageData
    const { rootId, elements, state } = a2uiDoc

    const splitMetaMap = new Map<string, { section_id: string; id_prefix: string }>()
    for (const slot of splitMeta || []) {
      if (slot.element_id) {
        splitMetaMap.set(slot.element_id, {
          section_id: slot.section_id,
          id_prefix: slot.id_prefix,
        })
      }
    }

    const iconCollector = new IconCollector()
    iconCollector.setState(state || {})

    const ctx: BuildContext = {
      elements,
      state: state || {},
      splitMetaMap,
      extracts: [],
      iconCollector,
      loopStack: [],
    }

    const rootTree = this.#buildTree(rootId, ctx, 0)
    if (!rootTree) {
      throw new Error(`[BuildTrees] rootId "${rootId}" 在 elements 中不存在`)
    }

    // 防御性：state 全量递归收集
    iconCollector.collectFromState()

    // 调用 icon API 解析
    const { iconNameMap } = await iconCollector.resolveAll()
    const iconNameSet = iconCollector.getIconNames()

    return {
      pageName,
      state: state || {},
      rootTree,
      extracts: ctx.extracts,
      iconNameSet,
      iconNameMap,
    } as BuiltPage
  }

  #buildTree(elementId: string, ctx: BuildContext, depth: number): RegularNode | null {
    if (depth > 200) {
      console.warn(`[BuildTrees] 深度超过 200，终止: ${elementId}`)
      return null
    }

    const el = ctx.elements.find(e => e.id === elementId)
    if (!el) {
      console.warn(`[BuildTrees] 引用的 id "${elementId}" 未定义，跳过`)
      return null
    }

    // 1. splitMeta 命中 → ExtractNode (purpose: 'module')
    const slotInfo = ctx.splitMetaMap.get(el.id)
    if (slotInfo) {
      return this.#buildAsExtractModule(el, ctx, slotInfo, depth)
    }

    // 2. 普通节点构建
    const isComponent = /^[A-Z]/.test(el.component)
    const processedProps = this.#processProps(el.props, el.id, el.component, ctx, isComponent)

    // 2a. 字面量 icon prop 收集（仅 Component 节点 + 在 mapping table 中）
    if (isComponent && this.#isIconComponent(el.component)) {
      ctx.iconCollector.collectFromNodeProps(el.component, processedProps)
    }

    // 3. children 处理
    const children = this.#processChildren(el.children, ctx, depth)

    const loopScope = buildLoopScope(ctx.loopStack)

    if (isComponent) {
      const node: ComponentNode = {
        kind: 'component',
        id: el.id,
        component: el.component,
        props: processedProps,
        children: children as any,
        _resolved: false,
        loopScope,
      }
      return node
    } else {
      // HTML 节点：value 下沉到 TextNode（如果适用）
      const { finalProps, finalChildren } = this.#sinkHtmlValueToText(
        el.component,
        processedProps,
        children,
        ctx.loopStack
      )
      const node: HtmlNode = {
        kind: 'html',
        id: el.id,
        tag: el.component,
        props: finalProps,
        children: finalChildren as any,
        _resolved: false,
        loopScope,
      }
      return node
    }
  }

  /**
   * 该组件是否在 icon 映射表里（直接 + 数组内嵌任一即可）
   */
  #isIconComponent(component: string): boolean {
    return !!(ICON_PROPS_BY_COMPONENT[component] || ICON_PROPS_NESTED_IN_ARRAYS[component])
  }

  // ── HTML value → TextNode 下沉 ──

  #sinkHtmlValueToText(
    tag: string,
    props: Record<string, PropValue>,
    children: RegularNode[] | LoopNode | null,
    loopStack: Array<{ loopNode: LoopNode }>
  ): { finalProps: Record<string, PropValue>; finalChildren: RegularNode[] | LoopNode | null } {
    if (!HTML_TEXT_ELEMENTS.has(tag)) {
      return { finalProps: props, finalChildren: children }
    }
    // 有原生 value 属性的元素不参与下沉
    if (HTML_VALUE_ATTRIBUTE_ELEMENTS.has(tag)) {
      return { finalProps: props, finalChildren: children }
    }
    if (!('value' in props)) {
      return { finalProps: props, finalChildren: children }
    }

    const value = props.value
    const { value: _, ...remainingProps } = props as any

    // TextNode：value 可以是字符串、BindingValue 或其他值
    const textNode: TextNode = {
      kind: 'text',
      value: value as any,
      _resolved: false,
      loopScope: buildLoopScope(loopStack),
    }

    let nextChildren: RegularNode[] | LoopNode | null
    if (children === null || children === undefined) {
      nextChildren = [textNode]
    } else if (Array.isArray(children)) {
      nextChildren = [...children, textNode]
    } else {
      // LoopNode 存在时不追加 textNode（避免语义混乱）
      nextChildren = children
    }

    return { finalProps: remainingProps, finalChildren: nextChildren }
  }

  // ── splitMeta 命中：构建 ExtractNode (purpose: 'module') ──

  #buildAsExtractModule(
    el: any,
    ctx: BuildContext,
    slotInfo: { section_id: string; id_prefix: string },
    depth: number
  ): ExtractNode {
    const componentName = this.#toPascalCase(slotInfo.section_id)

    const isComponent = /^[A-Z]/.test(el.component)
    const processedProps = this.#processProps(el.props, el.id, el.component, ctx, isComponent)
    if (isComponent && this.#isIconComponent(el.component)) {
      ctx.iconCollector.collectFromNodeProps(el.component, processedProps)
    }
    const children = this.#processChildren(el.children, ctx, depth)

    const loopScope = buildLoopScope(ctx.loopStack)

    const innerNode: RegularNode = isComponent
      ? {
          kind: 'component',
          id: el.id,
          component: el.component,
          props: processedProps,
          children: children as any,
          _resolved: false,
          loopScope,
        }
      : {
          kind: 'html',
          id: el.id,
          tag: el.component,
          props: processedProps,
          children: children as any,
          _resolved: false,
          loopScope,
        }

    const extract: ExtractNode = {
      kind: 'extract',
      componentName,
      purpose: 'module',
      body: [innerNode],
      _resolved: false,
      loopScope,
    }
    ctx.extracts.push(extract)
    return extract
  }

  // ── props 处理 ──

  #processProps(
    props: any,
    nodeId: string,
    component: string,
    ctx: BuildContext,
    isComponent: boolean
  ): Record<string, PropValue> {
    if (!props) return {}

    // 双条件：isComponent AND component 在 mapping 表中
    const isIconComponent = isComponent && this.#isIconComponent(component)

    // 分别查两个表（componentName 与 propsKey 是强关联，不合并）
    const directIconKeys = ICON_PROPS_BY_COMPONENT[component] || []
    const nestedIconKeys = ICON_PROPS_NESTED_IN_ARRAYS[component] || []

    const result: Record<string, PropValue> = {}
    for (const [key, value] of Object.entries(props)) {
      const isIconProp =
        isIconComponent &&
        (directIconKeys.includes(key) || nestedIconKeys.includes(key))
      result[key] = this.#processValue(key, value, nodeId, ctx, isIconProp, component, key)
    }
    return result
  }

  #processValue(
    key: string,
    value: any,
    nodeId: string,
    ctx: BuildContext,
    isIconProp: boolean = false,
    component?: string,
    propKey?: string
  ): PropValue {
    if (value === null || value === undefined) return null

    // {componentId} → SlotNodeValue
    if (
      value &&
      typeof value === 'object' &&
      (value as any).componentId &&
      !(value as any).path
    ) {
      const refNode = this.#buildTree((value as any).componentId, ctx, 0)
      return refNode ? Value.slotNode({ node: refNode }) : null
    }

    // {path} → BindingValue
    if (value && typeof value === 'object' && 'path' in (value as any)) {
      const path = (value as any).path as string
      const pathType = path.startsWith('/') ? 'absolute' : 'relative'

      const binding = Value.binding({
        path,
        pathType,
        accessPath: this.#computeAccessPath(path),
        nodeId,
        componentName: component,
        propKey,
      })

      // ★ 编译期 stateValue 快照：absolute 按 segments 直取；relative 借助 loopStack 推算
      binding.stateValue = pathType === 'absolute'
        ? (resolveBySegments(ctx.state, pathToSegments(path)) ?? null)
        : (this.#resolveRelativeBindingValue(path, ctx) ?? null)

      // 只有 icon prop 才触发 binding 的 state 收集
      if (isIconProp) {
        if (pathType === 'absolute') {
          // 绝对路径：stateValue 快照已是完整解析值（数组/对象/字符串），递归收集
          ctx.iconCollector.collectFromValue(binding.stateValue)
        } else {
          // 相对路径：沿 loopStack 解析循环数组【所有项】逐项收集
          // （icon 名可能各 item 不同，stateValue 快照只取首项不够）
          this.#collectRelativeIconFromLoop(path, ctx)
        }
      }

      return binding
    }

    // 嵌套对象 → 递归处理子属性
    if (Array.isArray(value)) {
      return value.map((v, i) =>
        this.#processValue(`${key}[${i}]`, v, nodeId, ctx)
      )
    }
    if (typeof value === 'object') {
      const nested: Record<string, PropValue> = {}
      for (const [k, v] of Object.entries(value)) {
        nested[k] = this.#processValue(`${key}.${k}`, v, nodeId, ctx)
      }
      return nested
    }

    // 字面量资源路径泛路改写（网络 URL 与非命中 pattern 的字符串原样返回）
    return typeof value === 'string' ? rewriteResourcePath(value) : value
  }

  // ── children 处理 ──

  #processChildren(
    children: any,
    ctx: BuildContext,
    depth: number
  ): RegularNode[] | LoopNode | null {
    if (children === undefined || children === null) return null

    if (typeof children === 'string') {
      return [this.#buildTextNode(children, ctx.loopStack)]
    }

    if (Array.isArray(children)) {
      const result: RegularNode[] = []
      for (const childId of children) {
        const node = this.#buildTree(childId, ctx, depth + 1)
        if (node) result.push(node)
      }
      return result
    }

    if (typeof children === 'object' && !Array.isArray(children)) {
      // 循环模板：{ path, componentId }
      if ((children as any).componentId) {
        return this.#buildLoopTemplate(children, ctx, depth)
      }
      return null
    }

    return null
  }

  // ── 循环模板：构造 LoopNode + ExtractNode (purpose: 'component') ──

  #buildLoopTemplate(
    loopInfo: { path: string; componentId: string },
    ctx: BuildContext,
    depth: number
  ): LoopNode | null {
    const dataBinding = Value.binding({
      path: loopInfo.path,
      pathType: loopInfo.path.startsWith('/') ? 'absolute' : 'relative',
      accessPath: this.#computeAccessPath(loopInfo.path),
    })

    const rootId = loopInfo.componentId
    const componentName = this.#toPascalCase(rootId) + 'Template'

    // ① 预创建壳节点，body 后续再填
    const extract: ExtractNode = {
      kind: 'extract',
      componentName,
      purpose: 'component',
      body: [],
      _resolved: false,
    }
    const loopNode = Node.loop({ data: dataBinding, template: extract })
    // 挂 loopScope（嵌套时的外层引用）
    loopNode.loopScope = buildLoopScope(ctx.loopStack)

    // ② 推栈（带上 loopNode 引用）
    const loopEntry = { loopVar: 'item', dataBinding, loopNode }
    ctx.loopStack.push(loopEntry)

    let templateNode: RegularNode | null
    try {
      templateNode = this.#buildTree(loopInfo.componentId, ctx, depth + 1)
    } finally {
      ctx.loopStack.pop()
    }
    if (!templateNode) return null

    // ③ body 建完再填
    extract.body = [templateNode]

    ctx.extracts.push(extract)
    return loopNode
  }

  // ── relative path binding 的 stateValue 求值 ──
  //
  // 策略：
  //   - 从 ctx.loopStack 顶端向底部找第一个 absolute dataBinding 作为根
  //   - 循环数据源约定必为数组（不存在对象兜底），取 [0] 作为首项
  //   - 把相对路径 segments 应用到首项上
  //   - 任意环节失败 → null
  //
  // 嵌套循环语义：外层 data.path=absolute，内层 data.path=relative，
  // 这正是从栈顶回溯到首个 absolute 的前提。

  #resolveRelativeBindingValue(relPath: string, ctx: BuildContext): any {
    if (ctx.loopStack.length === 0) return null

    // 1. 找到最近的 absolute 循环 dataBinding（作为根）
    let rootAbsBinding: { path: string; pathType: 'absolute' | 'relative'; accessPath: string } | null = null
    for (let i = ctx.loopStack.length - 1; i >= 0; i--) {
      const db = ctx.loopStack[i].dataBinding
      if (db.pathType === 'absolute') {
        rootAbsBinding = db
        break
      }
    }
    if (!rootAbsBinding) return null

    // 2. 取根循环数组首项（循环数据源约定必为数组）
    const rootSegments = pathToSegments(rootAbsBinding.path)
    const rootArr = resolveBySegments(ctx.state, rootSegments)
    if (!Array.isArray(rootArr)) return null   // 防御性：非数组视为无值
    const firstItem = rootArr[0]
    if (firstItem == null) return null

    // 3. 应用相对路径 segments 到首项
    const relSegments = pathToSegments(relPath)
    return resolveBySegments(firstItem, relSegments) ?? null
  }

  /**
   * 相对路径 icon binding 的收集：沿 loopStack 找最近 absolute 循环数据源，
   * 遍历数组【所有项】应用 relPath segments，把每项解析出的 icon 名交给 collector。
   *
   * 区别于 #resolveRelativeBindingValue（只取首项做 stateValue 快照）：
   *   icon 名可能各 item 不同（如 heart / heart-off），需全量收集才能命中 API 映射。
   */
  #collectRelativeIconFromLoop(relPath: string, ctx: BuildContext): void {
    if (ctx.loopStack.length === 0) return

    // 1. 找到最近的 absolute 循环 dataBinding（作为根）
    let rootAbsBinding: { path: string; pathType: 'absolute' | 'relative'; accessPath: string } | null = null
    for (let i = ctx.loopStack.length - 1; i >= 0; i--) {
      const db = ctx.loopStack[i].dataBinding
      if (db.pathType === 'absolute') {
        rootAbsBinding = db
        break
      }
    }
    if (!rootAbsBinding) return

    // 2. 取根循环数组（约定必为数组）
    const rootArr = resolveBySegments(ctx.state, pathToSegments(rootAbsBinding.path))
    if (!Array.isArray(rootArr)) return

    // 3. 对每一项应用相对路径 segments，收集 icon 名
    const relSegments = pathToSegments(relPath)
    for (const item of rootArr) {
      if (item == null) continue
      const v = resolveBySegments(item, relSegments)
      if (v !== undefined && v !== null) ctx.iconCollector.collectFromValue(v)
    }
  }

  // ── 辅助 ──

  #buildTextNode(value: string, loopStack: Array<{ loopNode: LoopNode }>) {
    return {
      kind: 'text' as const,
      value,
      _resolved: false,
      loopScope: buildLoopScope(loopStack),
    }
  }

  #computeAccessPath(path: string): string {
    if (!path.startsWith('/')) return path
    const segments = path.slice(1).split('/').filter(Boolean)
    if (segments.length === 0) return ''

    let accessPath = segments[0]
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]
      accessPath += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`
    }
    return accessPath
  }

  #toPascalCase(str: string): string {
    return str
      .replace(/[-_]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('')
  }
}