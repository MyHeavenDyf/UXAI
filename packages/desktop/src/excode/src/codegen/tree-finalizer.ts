/**
 * tree-finalizer — FileGenerator 树上处理层
 *
 * 对 rootTree 一次性 DFS，在 state-builder 完成之后：
 *
 *   B1: （已删除 — binding/computed 不再替换为 varRef，保留原类型供 jsx-emitter 直接序列化）
 *   B2: LoopNode.data 数据源引用处理（有 enrichment 时指向 enrichment constName）
 *   B3: ExtractNode → 注册到 extractedFiles；引用端替换为占位 ComponentNode
 *   B4: propRoute 消费（'inline' | 'module-top' | 'component-internal'）
 *   + 字面量双绑 lift（LiteralValue.useState → useState 声明）
 *
 * 输出：TreeFinalizerResult = { mainFile: FileDraft, extractedFiles: PendingExtractedFile[] }
 *
 * 不做（下一阶段 import-collector / jsx-emitter）：
 *   - import 收集、JSX 字符串生成
 *   - 文件顶部 const 拼装（file-assembler 按 FileUnit 信息生成）
 */

import path from 'path'

import type { BuildNode, ComponentNode, HtmlNode, TextNode, ExtractNode, LoopNode, RegularNode } from '../core/node-types'
import type { PropValue, VarRefValue } from '../core/value-types'
import { Value } from '../core/value-factory'
import type { StateBuilderResult } from './state-builder'
import { stateRef, makeEnrichmentConstName } from '../core/access-path'

// ─── 产出物 ───

export interface PendingConstDecl {
  name: string
  value: PropValue
  isUseState?: boolean
  /** 共享标记：该 const 来自 eventMutatedPaths 命中的 binding/computed → emit useSharedState 而非 useState/initialState */
  shared?: boolean
  /** 共享 store 的顶层 key（v.accessPath，如 'isDetailOpen'）；shared=true 时必填 */
  sharedKey?: string
  /** 共享只读（无 useState 的 shared binding）→ emit `const name = useSharedState(key)`（单常量，无 setter） */
  sharedRead?: boolean
}

export interface PendingExtractedFile extends Pick<ExtractNode, 'purpose' | 'fileName'> {
  path: string
  componentName: string
  body: BuildNode[]
  params?: Record<string, PropValue>
  moduleTopConsts?: PendingConstDecl[]
  componentInternalConsts?: PendingConstDecl[]
}

export interface FileDraft {
  path: string
  componentName: string
  rootTree: BuildNode
  moduleTopConsts: PendingConstDecl[]
  componentInternalConsts: PendingConstDecl[]
}

export interface TreeFinalizerResult {
  mainFile: FileDraft
  extractedFiles: PendingExtractedFile[]
}

// ─── 上下文 ───

interface TreeCtx {
  /** pageName（用于路径生成） */
  pageName: string
  /** 当前正在编辑的文件草稿 */
  currentDraft: FileDraft
  /** 累计的抽取文件 */
  extractedFiles: PendingExtractedFile[]
  /** loopId → enrichment constName（来自 state-builder） */
  loopEnrichmentMap: Map<string, { constName: string }>
}

// ─── 工具 ───

function buildExtractedFilePath(pageName: string, componentName: string, purpose: 'module' | 'component'): string {
  const dir = purpose === 'module' ? 'modules' : 'components'
  return `src/pages/${pageName}/${dir}/${componentName}.tsx`
}

function buildRefImportPath(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
  if (!rel.startsWith('./') && !rel.startsWith('../')) rel = './' + rel
  return rel
}

function toPageComponentName(pageName: string): string {
  const pascal = pageName
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  return `${pascal}Page`
}

/** propRoute / useState lift 后常量名生成（小驼峰） */
function makePropRouteName(nodeId: string | undefined, componentName: string, propKey: string): string {
  // 格式：${lowerCamel(componentName)}${Capitalize(propKey)}${nodeId}
  // 例：{ componentName: 'Button', nodeId: 'hdrHelpBtn', propKey: 'icon' } → buttonIconHdrHelpBtn
  // 缺 nodeId 时退化为 ${lowerCamel(componentName)}${Capitalize(propKey)}
  // 缺 componentName 时退化为 ${nodeId}${Capitalize(propKey)}
  const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
  const lowerFirst = (s: string) => s ? s.charAt(0).toLowerCase() + s.slice(1) : ''

  if (componentName && nodeId) {
    return `${lowerFirst(componentName)}${cap(propKey)}${cap(nodeId)}`
  }
  if (componentName) {
    return `${lowerFirst(componentName)}${cap(propKey)}`
  }
  return `${nodeId ?? 'node'}${cap(propKey)}`
}

/**
 * useState 初始值的引用名。
 *
 * 与 jsx-emitter 对绝对 binding 的 emit 规则保持一致（收拢到 accessPath.stateRef）：
 *   - 绝对路径：平面→裸 accessPath（已 destructure）；嵌套→initialState.xxx
 *   - 相对路径→裸 accessPath（模板从 data 解构顶级字段，再属性访问）
 */
function useStateRefName(cv: { pathType: string; accessPath: string }): string {
  if (cv.pathType === 'absolute') return stateRef(cv.accessPath)
  return cv.accessPath
}

// ─── B4: propRoute 消费 ───

function applyPropRoute(node: ComponentNode, ctx: TreeCtx): ComponentNode {
  const pr = node.propRoute
  if (!pr || Object.keys(pr).length === 0) return node

  const newProps: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(node.props)) {
    const route = pr[k]
    if (!route || route === 'inline') {
      newProps[k] = v
      continue
    }
    const name = makePropRouteName(node.id, node.component, k)
    if (route === 'component-internal') {
      // 检测 useState：LiteralValue.useState 或 ComputedValue.useState
      const vObj = v && typeof v === 'object' ? (v as any) : null
      const isLiteralWithUseState = vObj && vObj.type === 'literal' && vObj.useState
      const isComputedWithUseState = vObj && vObj.type === 'computed' && vObj.useState

      if (isComputedWithUseState) {
        // ComputedValue.useState：初始值引用 accessPath
        // 嵌套绝对路径走 initialState.xxx；平面绝对 / 相对路径走裸 accessPath
        ctx.currentDraft.componentInternalConsts.push({
          name,
          value: Value.varRef({ name: useStateRefName(vObj) }),
          isUseState: true,
          // 共享：path 命中 eventMutatedPaths（state-builder 打标）→ emit useSharedState
          ...(vObj.shared ? { shared: true, sharedKey: vObj.accessPath } : {}),
        })
      } else if (isLiteralWithUseState) {
        // LiteralValue.useState：值直接作为初始值
        ctx.currentDraft.componentInternalConsts.push({
          name,
          value: vObj.value,
          isUseState: true,
        })
      } else {
        ctx.currentDraft.componentInternalConsts.push({
          name,
          value: v,
          isUseState: false,
        })
      }

      // 生成 event handler（LiteralValue / ComputedValue 的 useState 均适用）
      const useStateMarker = isLiteralWithUseState ? (vObj as any).useState : (isComputedWithUseState ? (vObj as any).useState : null)
      if (useStateMarker?.event && typeof useStateMarker.extractor === 'function') {
        const setterName = 'set' + name.charAt(0).toUpperCase() + name.slice(1)
        const handler = useStateMarker.extractor(setterName)
        newProps[useStateMarker.event] = Value.rawExpr({ value: handler })
      }
    } else {
      ctx.currentDraft.moduleTopConsts.push({ name, value: v })
    }
    newProps[k] = Value.varRef({ name })
  }
  return { ...node, props: newProps }
}

// ─── 字面量/Computed 双绑 lift ───

function liftLiteralTwoWayBindings<T extends { props: Record<string, PropValue> }>(node: T, ctx: TreeCtx): T {
  const newProps: Record<string, PropValue> = {}
  let touched = false

  for (const [key, value] of Object.entries(node.props)) {
    if (!value || typeof value !== 'object' || !(value as any).useState) {
      newProps[key] = value
      continue
    }
    const v = value as any
    const isComputed = v.type === 'computed'

    // 只处理 literal 或 computed + useState
    if (v.type !== 'literal' && v.type !== 'computed') {
      newProps[key] = value
      continue
    }

    const name = makePropRouteName(
      (node as any).id,
      (node as any).component ?? 'node',
      key
    )

    if (isComputed) {
      // ComputedValue.useState：嵌套绝对路径走 initialState.xxx，平面绝对 / 相对走裸 accessPath
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: Value.varRef({ name: useStateRefName(v) }),
        isUseState: true,
        // 共享：path 命中 eventMutatedPaths（state-builder 打标）→ emit useSharedState
        ...(v.shared ? { shared: true, sharedKey: v.accessPath } : {}),
      })
    } else {
      // LiteralValue.useState：值直接作为初始值
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: v.value ?? null,
        isUseState: true,
      })
    }

    if (v.useState.event && typeof v.useState.extractor === 'function') {
      const setterName = 'set' + name.charAt(0).toUpperCase() + name.slice(1)
      const handler = v.useState.extractor(setterName)
      newProps[v.useState.event] = Value.rawExpr({ value: handler })
    }
    newProps[key] = Value.varRef({ name })
    touched = true
  }
  return touched ? { ...node, props: newProps } as T : node
}

// ─── B1b: 共享只读 binding lift（无 useState 的 shared absolute binding/computed） ───
//
// 被事件 Action 改写的 path（eventMutatedPaths）若被某组件只读绑定（非 useState 双绑），
// 必须提升为组件顶部 `const x = useSharedState('key')`（订阅 store 切片）——
// useSharedState 是 hook，不能 inline 在 JSX prop 里（rules-of-hooks）。
// 非共享只读 binding 仍 inline initialState.xxx（快照只读，无运行时写入）。

function liftSharedReadBindings<T extends { props: Record<string, PropValue> }>(node: T, ctx: TreeCtx): T {
  const newProps: Record<string, PropValue> = {}
  let touched = false
  for (const [key, value] of Object.entries(node.props)) {
    const v = value as any
    if (
      v && typeof v === 'object' &&
      v.__node &&
      (v.type === 'binding' || v.type === 'computed') &&
      v.shared === true &&
      v.pathType === 'absolute' &&
      !v.useState
    ) {
      const name = makePropRouteName((node as any).id, (node as any).component ?? 'node', key)
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: Value.rawExpr({ value: 'null' }),  // 占位：formatConstDecl sharedRead 不读 value
        isUseState: false,
        shared: true,
        sharedKey: v.accessPath,
        sharedRead: true,
      })
      newProps[key] = Value.varRef({ name })
      touched = true
    } else {
      newProps[key] = value
    }
  }
  return touched ? ({ ...node, props: newProps } as T) : node
}

// ─── B2: LoopNode 数据源引用处理 ───
//
// 关键：loop template 也是一个 ExtractNode（purpose: 'component'），其 body 应该
// 在模板自己的 childDraft 中走，而不是在主 draft 中。routeLoopNode 必须：
//   1. 切到 childDraft
//   2. 在 childDraft 中走 body
//   3. 把 template 注册到 extractedFiles（避免在末尾 extracts 循环中重复处理）

function routeLoopNode(loop: LoopNode, parentNodeId: string, ctx: TreeCtx): LoopNode {
  const loopId = parentNodeId + ':' + (loop.template?.componentName ?? '')
  const enrich = ctx.loopEnrichmentMap.get(loopId)
  const dataBinding = loop.data as any
  let dataRefName: string
  // pathType 标记 loop.data 来源：absolute（顶层 state/const，嵌套时外层不该 destructure）
  // vs relative（外层 item 字段，外层需 destructure）。供 collectRelativeFields 区分。
  let dataPathType: 'absolute' | 'relative' = 'absolute'
  if (enrich) {
    // 富集：const 名（如 images_galImageGridEnriched），由文件顶部声明，裸引用即可
    dataRefName = enrich.constName
  } else if (dataBinding.pathType === 'absolute') {
    // 绝对路径：平面→裸（已 destructure）；嵌套→initialState.xxx（收拢到 accessPath.stateRef）
    dataRefName = stateRef(dataBinding.accessPath)
  } else {
    // 相对路径（模板内从 data 解构）→ 裸引用
    dataRefName = dataBinding.accessPath ?? dataBinding.path ?? 'data'
    dataPathType = 'relative'
  }

  // inline loop（如 TabItem）：模板不抽离，body 走当前 draft，不注册 extractedFiles
  if (loop.inline) {
    const newBody = loop.template.body.map(c => walkNode(c, ctx))
    return {
      ...loop,
      data: Value.varRef({ name: dataRefName, pathType: dataPathType }),
      template: {
        ...loop.template,
        body: newBody as RegularNode[],
      },
    }
  }

  // 切到 template 的 childDraft
  const targetPath = buildExtractedFilePath(ctx.pageName, loop.template.componentName, 'component')
  const childDraft: FileDraft = {
    path: targetPath,
    componentName: loop.template.componentName,
    rootTree: null as any,
    moduleTopConsts: [],
    componentInternalConsts: [],
  }
  const prevDraft = ctx.currentDraft
  ctx.currentDraft = childDraft

  const newBody = loop.template.body.map(c => walkNode(c, ctx))

  ctx.currentDraft = prevDraft

  // 注册到 extractedFiles（标记同名跳过，避免末尾循环重复）
  ctx.extractedFiles.push({
    path: targetPath,
    componentName: loop.template.componentName,
    purpose: 'component',
    body: newBody,
    params: loop.template.refProps,
    moduleTopConsts: childDraft.moduleTopConsts,
    componentInternalConsts: childDraft.componentInternalConsts,
  })

  return {
    ...loop,
    data: Value.varRef({ name: dataRefName, pathType: dataPathType }),
    template: {
      ...loop.template,
      body: newBody as RegularNode[],
    },
  }
}

// ─── DFS 主循环 ───

function walkNode(node: BuildNode, ctx: TreeCtx): BuildNode {
  if (!node) return node as any

  switch (node.kind) {
    case 'component':
      return walkComponent(node as ComponentNode, ctx)
    case 'html':
      return walkHtml(node as HtmlNode, ctx)
    case 'text':
      return node  // TextNode 无需要处理
    case 'extract':
      return walkExtract(node as ExtractNode, ctx)
    default:
      return node
  }
}

function walkComponent(node: ComponentNode, ctx: TreeCtx): ComponentNode {
  const routed = applyPropRoute(node, ctx)
  const lifted = liftLiteralTwoWayBindings(routed, ctx)
  const shared = liftSharedReadBindings(lifted, ctx)
  const newChildren = walkChildren(shared.children, ctx, shared.id ?? '')
  return { ...shared, children: newChildren as any }
}

function walkHtml(node: HtmlNode, ctx: TreeCtx): HtmlNode {
  const lifted = liftLiteralTwoWayBindings(node, ctx)
  const shared = liftSharedReadBindings(lifted, ctx)
  const newChildren = walkChildren(shared.children, ctx, node.id ?? '')
  return { ...shared, children: newChildren as any }
}

function walkExtract(node: ExtractNode, ctx: TreeCtx): ComponentNode {
  // B3: ExtractNode → 记录到 extractedFiles；引用端替换为占位 ComponentNode
  const targetPath = buildExtractedFilePath(ctx.pageName, node.componentName, node.purpose)
  const refImport = buildRefImportPath(ctx.currentDraft.path, targetPath)

  // 切到子草稿
  const childDraft: FileDraft = {
    path: targetPath,
    componentName: node.componentName,
    rootTree: null as any,
    moduleTopConsts: [],
    componentInternalConsts: [],
  }
  const prevDraft = ctx.currentDraft
  ctx.currentDraft = childDraft

  const newBody = node.body.map(c => walkNode(c, ctx))

  ctx.currentDraft = prevDraft

  ctx.extractedFiles.push({
    path: targetPath,
    componentName: node.componentName,
    purpose: node.purpose,
    body: newBody,
    params: node.refProps,
    moduleTopConsts: childDraft.moduleTopConsts,
    componentInternalConsts: childDraft.componentInternalConsts,
  })

  const placeholder: any = {
    __node: true,
    kind: 'component',
    component: node.componentName,
    tag: node.componentName,
    import: refImport,
    props: node.refProps ?? {},
    children: null,
    __extractRef: true,
  }
  if ((node as any).id !== undefined) placeholder.id = (node as any).id

  return placeholder
}

function walkChildren(
  children: RegularNode[] | LoopNode | null | undefined,
  ctx: TreeCtx,
  parentNodeId: string = ''
): RegularNode[] | LoopNode | null {
  if (!children) return null
  if ((children as any).kind === 'loop') {
    return routeLoopNode(children as LoopNode, parentNodeId, ctx)
  }
  return (children as RegularNode[]).map(c => walkNode(c, ctx)) as RegularNode[]
}

// ─── 主入口 ───

interface ExtractSpec {
  body: BuildNode[]
  purpose: 'module' | 'component'
  componentName: string
  props?: Record<string, PropValue>
  id?: string
}

export function finalizeTree(
  mappedPage: { pageName: string; rootTree: BuildNode; extracts?: ExtractSpec[] },
  stateResult: StateBuilderResult
): TreeFinalizerResult {
  const mainDraft: FileDraft = {
    path: `src/pages/${mappedPage.pageName}/index.tsx`,
    componentName: toPageComponentName(mappedPage.pageName),
    rootTree: {} as any,
    moduleTopConsts: [],
    componentInternalConsts: [],
  }

  const ctx: TreeCtx = {
    pageName: mappedPage.pageName,
    currentDraft: mainDraft,
    extractedFiles: [],
    loopEnrichmentMap: stateResult.loopEnrichmentMap,
  }

  // 主树走 DFS
  mainDraft.rootTree = walkNode(mappedPage.rootTree, ctx)

  // MappedPage.extracts — 已在 rootTree 中以 ExtractNode 形式被处理的同名文件不再重复
  for (const ext of mappedPage.extracts ?? []) {
    if (ctx.extractedFiles.some(e => e.componentName === ext.componentName)) continue
    // 跳过被映射文件吞噬的循环模板（purpose='component' 但树中未出现，如 Table 自行消化了 LoopNode）
    if (ext.purpose === 'component') continue
    const targetPath = buildExtractedFilePath(mappedPage.pageName, ext.componentName, ext.purpose)
    ctx.extractedFiles.push({
      path: targetPath,
      componentName: ext.componentName,
      purpose: (ext as any).purpose ?? 'module',
      body: ext.body.map(c => walkNode(c, ctx)) as BuildNode[],
      params: ext.props,
    })
  }

  return {
    mainFile: mainDraft,
    extractedFiles: ctx.extractedFiles,
  }
}
