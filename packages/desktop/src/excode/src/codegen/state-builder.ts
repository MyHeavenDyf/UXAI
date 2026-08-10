/**
 * state-builder — State 消费与 ComputedValue 求值（方案 A）
 *
 * 核心机制：
 *   NodeMapper 走完之后，state-builder 自己递归走树。
 *   不再依赖 NodeMapper 收集的 DataManifest，而是通过三种通道消费数据：
 *
 *     1. consumeProps 时：
 *        - absolute BindingValue → 收集引用 → state.js 生成
 *        - absolute ComputedValue(containsJSX:false) → 编译期求值 → state.js 生成
 *        - absolute ComputedValue(containsJSX:true)  → 编译期求值 → 文件单元 moduleTopConsts
 *        - SlotNode / RenderFn 递归进入子树
 *        - 数组 / 纯对象递归查找内嵌的 SlotNode / RenderFn
 *
 *     2. processLoop 时：
 *        - 收集 template.body 内 relative ComputedValue → enrichment
 *        - 含 JSX → 模板文件单元 enrichmentConsts
 *        - 不含 JSX → stateEntries
 *        - 切到模板文件单元，继续走 template.body
 *
 *     3. ExtractNode 时：
 *        - 文件边界，切到对应文件单元
 *
 * 不再输出 varRefMappings（binding 和 computed 保留原类型，jsx-emitter 直接识别）。
 * tree-finalizer 不再需要 rewriteValueForVars。
 */

import type { MappedPage } from '../pipeline/pipeline-context'
import type { BuildNode, LoopNode, ExtractNode, RegularNode, RenderFnScope, Scope } from '../core/node-types'
import type { BindingValue, ComputedValue, ComputedTransformCtx, PropValue } from '../core/value-types'
import { resolveIcon } from '../core/icon-collection'
import { collectRelativeCVsDeep, applyScopedCV } from '../core/scoped-enrichment'
import { rewriteResourcePathsInValue } from '../core/resource-path'
import { jsxConstName, makeEnrichmentConstName } from '../core/access-path'
import { setNested, pathToSegments, resolveBySegments } from '../core/state-path'
import { serializePlainJs } from './js-serializer'

// ─── 文件单元 ───

export interface FileUnit {
  fileKey: string
  /** 绝对路径 binding 的对象引用（用于生成 state.js + 文件顶部 destructure） */
  bindingRefs: BindingValue[]
  /** 绝对路径 computed 的对象引用（containsJSX:false，用于生成 state.js + 文件顶部 destructure） */
  computedRefs: ComputedValue[]
  /** containsJSX:true 的 absolute computed 编译求值结果 */
  jsxLiteralConsts: JsxLiteralConst[]
  /** 循环 enrichment 产物 */
  enrichmentConsts: EnrichmentConst[]
}

export interface JsxLiteralConst {
  name: string
  value: any
}

export interface EnrichmentConst {
  name: string
  value: any[]
  containsJSX: boolean
}

// ─── 上下文 ───

interface StateBuilderContext {
  rawState: Record<string, any>

  /** 所有文件单元（main / modules/* / components/*） */
  fileUnits: Map<string, FileUnit>
  /** 当前正在写入的文件单元 */
  currentUnit: FileUnit

  /** 当前作用域链（循环/ render fn 范围内联用） */
  currentScope?: Scope

  /** 全局 state 数据集（最终 → state.js 的 initialState） */
  stateEntries: Record<string, any>

  /** 图标映射表（供 ComputedTransformCtx.resolveIcon 使用） */
  iconNameMap: Record<string, string>

  /**
   * loop enrichment 映射（tree-finalizer routeLoopNode 用）
   * key = `${parentNodeId}:${template.componentName}`
   * value = enrichment 后的 constName
   */
  loopEnrichmentMap: Map<string, { constName: string }>
}

// ─── StateBuilderResult ───

export interface StateBuilderResult {
  /** state.js 完整内容 */
  stateContent: string
  /** 新 state 结构化数据 */
  newState: Record<string, any>
  /** 按文件单元划分的收集结果 */
  fileUnits: Map<string, FileUnit>
  /**
   * loop enrichment 映射（tree-finalizer routeLoopNode 用）
   * key = `${parentNodeId}:${template.componentName}`
   * value = enrichment 后的 constName
   * 没有 enrichment 的循环不在 map 中（routeLoopNode 回退到 loop.data.accessPath）
   */
  loopEnrichmentMap: Map<string, { constName: string }>
}

// ─── 工具 ───

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



function getOrCreateUnit(ctx: StateBuilderContext, fileKey: string): FileUnit {
  let unit = ctx.fileUnits.get(fileKey)
  if (!unit) {
    unit = { fileKey, bindingRefs: [], computedRefs: [], jsxLiteralConsts: [], enrichmentConsts: [] }
    ctx.fileUnits.set(fileKey, unit)
  }
  return unit
}

function withUnit(ctx: StateBuilderContext, unit: FileUnit, fn: () => void): void {
  const prev = ctx.currentUnit
  ctx.currentUnit = unit
  fn()
  ctx.currentUnit = prev
}

/** 取 absolute 循环数据源（state 数组）。
 *  relative 嵌套循环在 processLoop isRelativeNested 跳过（由 applyScopedCV loopChain 处理）；
 *  顶层 relative 无 loopScope 为异常，返回 [] 触发 warn。 */
function resolveLoopData(loop: LoopNode, ctx: StateBuilderContext): any[] {
  const data = loop.data as BindingValue  // state-builder 阶段 LoopNode.data 还是 BindingValue
  // 只处理 absolute（顶层 state 数据源数组）；relative 嵌套循环在 processLoop isRelativeNested 跳过
  // （由 applyScopedCV loopChain 处理），顶层 relative 无 loopScope 为异常（返回 [] 触发 warn）
  if (data.pathType !== 'absolute') return []
  const val = getValueFromState(ctx.rawState, data.path)
  return Array.isArray(val) ? val : (val != null ? [val] : [])
}

/**
 * 构建 ComputedTransformCtx——供 ComputedValue.transform 在求值阶段使用。
 * currentItem 由 enrichment（applyScopedCV）递归内更新为当前项；absolute computed 不设（transform 内 path 都 absolute）。
 */
function buildTransformCtx(
  rawState: Record<string, any>,
  iconNameMap: Record<string, string>
): ComputedTransformCtx {
  const ctx: ComputedTransformCtx = {
    rawState,
    currentItem: undefined,
    resolveIcon: (name, props?) => resolveIcon(name, iconNameMap, props) as any,
    resolveValueFromPath: (path: string) => {
      if (!path) return undefined
      if (path.startsWith('/')) return getValueFromState(rawState, path)
      // relative：从 currentItem（当前项）按段解析
      return ctx.currentItem != null ? resolveBySegments(ctx.currentItem, pathToSegments(path)) : undefined
    },
  }
  return ctx
}


// ─── state.js 生成 ───

function generateStateFileContent(stateEntries: Record<string, any>): string {
  const lines: string[] = []
  lines.push('export const initialState = ' + serializePlainJs(stateEntries, 2) + ';')
  lines.push('')
  lines.push('export default initialState;')
  return lines.join('\n')
}

// ─── 构建 computed key ───
// 语义已收拢到 core/access-path.ts（jsxConstName / computedJsxConstName / stateRef / isFlatAccessPath），
// stateBuilder 与 jsxEmitter / treeFinalizer / fileAssembler 共用，保证 const 名、引用、destructure 一致。

function makeComputedKey(cv: ComputedValue, nodeId?: string, propKey?: string): string {
  // identResolver 优先（保持原签名兼容）；否则走 accessPath.jsxConstName
  if (cv.identResolver) {
    return cv.identResolver({ defaultName: cv.accessPath, sourceType: 'computed', componentName: cv.componentName, propKey, nodeId })
  }
  return jsxConstName(cv.accessPath)
}

// ═══════════════════════════════════════════════
//  walk 树（核心递归）
// ═══════════════════════════════════════════════

function walk(node: BuildNode, ctx: StateBuilderContext): void {
  switch (node.kind) {
    case 'component':
    case 'html':
      consumeProps(node.props, ctx)
      walkChildren(node.children, ctx, (node as any).id ?? '')
      return
    case 'text':
      consumeTextValue(node.value, ctx)
      return
    case 'extract':
      // 文件边界：切到对应文件单元，走 body
      {
        const extNode = node as ExtractNode
        const fileKey = extNode.purpose === 'module'
          ? `modules/${extNode.componentName}`
          : `components/${extNode.componentName}`
        const unit = getOrCreateUnit(ctx, fileKey)
        withUnit(ctx, unit, () => {
          for (const c of extNode.body) walk(c, ctx)
        })
      }
      return
    case 'loop':
      // LoopNode 正常情况下不会在 walk 顶层出现（它在 children 中被 walkChildren 捕获）
      // 但防御性处理
      walkChildren(node as any, ctx, '')
      return
  }
}

function walkChildren(
  children: RegularNode[] | LoopNode | null | undefined,
  ctx: StateBuilderContext,
  parentNodeId: string
): void {
  if (!children) return
  if ((children as any).kind === 'loop') {
    processLoop(children as LoopNode, ctx, parentNodeId)
    return
  }
  for (const c of children as RegularNode[]) walk(c, ctx)
}

// ─── consumeProps / consumeValue ───

function consumeProps(props: Record<string, PropValue> | undefined, ctx: StateBuilderContext): void {
  if (!props) return
  for (const v of Object.values(props)) consumeValue(v, ctx)
}

function consumeTextValue(value: string | BindingValue | ComputedValue | undefined, ctx: StateBuilderContext): void {
  if (!value || typeof value !== 'object') return
  consumeValue(value, ctx)
}

/**
 * 递归消费一个 PropValue，做三件事：
 *   1. absolute binding → 收集引用
 *   2. absolute computed → 求值，分流（state.js / jsx-literal）
 *   3. slotNode / renderFn → walk 进入子树
 *   4. 数组 / 纯对象 → 递归查找内嵌的 slotNode / renderFn / binding / computed
 *
 * 字面量（string/number/boolean/null）、varRef、rawExpr、LiteralValue → 跳过
 */
function consumeValue(v: any, ctx: StateBuilderContext): void {
  if (v === null || v === undefined) return
  if (typeof v !== 'object') return

  // 数组 → 递归每个元素
  if (Array.isArray(v)) {
    for (const item of v) consumeValue(item, ctx)
    return
  }

  switch (v.type) {
    // ── absolute path binding → 收集引用 ──
    case 'binding':
      if (v.pathType === 'absolute') {
        ctx.currentUnit.bindingRefs.push(v)
        // 同时写入全局 stateEntries（binding 值裸取 rawState），保持嵌套结构
        if (v.accessPath) {
          const raw = getValueFromState(ctx.rawState, v.path)
          if (raw !== undefined) setNested(ctx.stateEntries, v.accessPath, raw)
        }
      }
      return

    // ── absolute path computed → 求值并分流 ──
    case 'computed':
      if (v.pathType === 'absolute') {
        if (v.containsJSX) {
          // containsJSX:true → 算值后走文件单元 jsxLiteralConsts
          const raw = getValueFromState(ctx.rawState, v.path)
          const name = makeComputedKey(v, (v as any).nodeId, (v as any).propKey)
          try {
            const ctxForCv = buildTransformCtx(ctx.rawState, ctx.iconNameMap)
            const result = v.transform(raw, ctxForCv)
            ctx.currentUnit.jsxLiteralConsts.push({ name, value: result })
          } catch (err: any) {
            console.warn(`  [warn] state-builder: computed 求值失败 (path: ${v.path}): ${err.message}`)
          }
        } else {
          // containsJSX:false → 求值后进 stateEntries + 收集引用
          ctx.currentUnit.computedRefs.push(v)
          if (v.accessPath) {
            const raw = getValueFromState(ctx.rawState, v.path)
            try {
              const ctxForCv = buildTransformCtx(ctx.rawState, ctx.iconNameMap)
              setNested(ctx.stateEntries, v.accessPath, v.transform(raw, ctxForCv))
            } catch (err: any) {
              console.warn(`  [warn] state-builder: computed 求值失败 (path: ${v.path}): ${err.message}`)
            }
          }
        }
      }
      return

    // ── slotNode → walk 进入子树 ──
    case 'slotNode':
      walk(v.node, ctx)
      return

    // ── renderFn → 扫描 dataSource 参数，建立 RenderFnScope，walk 进入 body ──
    case 'renderFn': {
      const renderFn = v as any
      const params: Array<{ name: string; dataSource?: any }> = renderFn.params ?? []

      // 收集 dataSource 参数
      const dataSources: Record<string, BindingValue> = {}
      for (const p of params) {
        if (p.dataSource) dataSources[p.name] = p.dataSource
      }

      if (Object.keys(dataSources).length > 0) {
        // 建立 RenderFnScope
        const newScope: RenderFnScope = {
          scopeType: 'renderFnScope',
          paramBindings: dataSources,
          parent: ctx.currentScope as any,
        }
        const prevScope = ctx.currentScope
        ctx.currentScope = newScope as any
        try {
          const body = Array.isArray(v.body) ? v.body : [v.body]
          for (const child of body) walk(child, ctx)
        } finally {
          ctx.currentScope = prevScope
        }
      } else {
        // 无 dataSource → 普通 walk
        const body = Array.isArray(v.body) ? v.body : [v.body]
        for (const child of body) walk(child, ctx)
      }
      return
    }

    // ── varRef / rawExpr / literal → 跳过（不消费） ──
    case 'varRef':
    case 'rawExpr':
    case 'literal':
      return
  }

  // ── 纯对象（无 type 字段）→ 递归属性，查找内嵌的 binding/computed/slotNode/renderFn ──
  if (!v.__node && typeof v === 'object') {
    for (const item of Object.values(v)) consumeValue(item, ctx)
  }
}

// ─── processLoop ───

function processLoop(loop: LoopNode, ctx: StateBuilderContext, parentNodeId: string): void {
  // render fn body 内的循环：enrichment 已由 dataset（enrichScopedData）接管，
  // 且 emit 时强制 inline（jsxEmitter forceInline）→ 不产生单独模板文件。
  // 这里只把 template body 走进当前单元（收集 absolute binding 等），不建孤儿模板单元、不做 enrichment。
  // 检测：ctx.currentScope 为 RenderFnScope（仅 render fn body walk 时设，processLoop 不改它）。
  if (ctx.currentScope && ctx.currentScope.scopeType === 'renderFnScope') {
    withUnit(ctx, ctx.currentUnit, () => {
      for (const child of loop.template.body) walk(child, ctx)
    })
    return
  }

  // relative 嵌套循环：数据是外层 item 的子字段，外层深 enrichment 已处理（applyScopedCV 沿 loopChain）。
  // 跳过独立 enrichment，只 walk template body（收 state 引用 + imports）。
  const loopData = loop.data as BindingValue  // state-builder 阶段还是 BindingValue
  const isRelativeNested = loopData.pathType === 'relative' && loop.loopScope
  if (isRelativeNested) {
    const isInline = !!loop.inline
    const templateUnit = isInline ? ctx.currentUnit : getOrCreateUnit(ctx, `components/${loop.template.componentName}`)
    withUnit(ctx, templateUnit, () => {
      for (const child of loop.template.body) walk(child, ctx)
    })
    return
  }

  // 以下：absolute 循环 或 顶层 relative 循环（无 loopScope）→ 做 enrichment
  const isInline = !!loop.inline
  // 1. 解析原始数据源
  const rawData = resolveLoopData(loop, ctx)
  if (rawData.length === 0) {
    console.warn(
      `  [warn] state-builder: 循环 "${loop.template.componentName}" 数据为空（path: ${loopData.path}），跳过 enrichment`
    )
    const templateUnit = isInline ? ctx.currentUnit : getOrCreateUnit(ctx, `components/${loop.template.componentName}`)
    withUnit(ctx, templateUnit, () => {
      for (const child of loop.template.body) walk(child, ctx)
    })
    return
  }

  // 2. 深度收集 template.body 内 relative ComputedValue（含嵌套 relative 循环，带 loopChain）
  const scopedCVs = collectRelativeCVsDeep(loop.template.body)
  const containsJSX = scopedCVs.some(({ cv }) => cv.containsJSX)

  const constName = makeEnrichmentConstName(loopData.path, parentNodeId)
  const isAbsolute = loopData.pathType === 'absolute'

  // 3. 无 enrichment（无 relative computed）
  if (scopedCVs.length === 0) {
    if (isAbsolute) {
      setNested(ctx.stateEntries, loopData.accessPath, rawData)
      ctx.currentUnit.bindingRefs.push(loopData)
    }
  } else {
    // 4. 做整体 enrichment（深收集 + applyScopedCV 沿 loopChain 逐层 map 进嵌套数组）

    // 4a. 去重：同一相对 path 可能绑定到模板内多个节点（如 Icon.name 与 Button.icon 都绑
    //     favoriteIcon），各自产出 path 相同的 ComputedValue。若都写 out[cv.path] 会撞键——
    //     后一个 CV 从 out（已被前一个 CV 改写）读到 BuildNode 而非原始 string → transform 返回 null。
    //     处理：第一个 CV 保留原 key；后续撞键的 CV 生成新 key 并改写其 accessPath
    //     （applyScopedCV 按 accessPath 写、collectRelativeFields 按 accessPath 收 destructure 字段），
    //     cv.path 保留原值用于读原始 item 数据。
    const usedKeys = new Set<string>()
    for (const { cv } of scopedCVs) {
      let key = (cv as any).accessPath ?? cv.path
      if (usedKeys.has(key)) {
        let i = 1
        while (usedKeys.has(`${key}_${i}`)) i++
        key = `${key}_${i}`
        ;(cv as any).accessPath = key
      }
      usedKeys.add(key)
    }

    const enrichedData = rawData.map((item: any) => {
      if (item === null || typeof item !== 'object') return item
      // deep clone：setNested 写嵌套路径会改 sub-object，shallow copy 会污染 rawState
      const out = structuredClone(item)
      // 循环内 relative computed → cvCtx.currentItem 由 applyScopedCV 递归内更新为当前项，
      // transform 内 resolveValueFromPath(relative) 从 currentItem 解析
      const ctxForCv = buildTransformCtx(ctx.rawState, ctx.iconNameMap)
      for (const { cv, loopChain } of scopedCVs) {
        applyScopedCV(out, loopChain, cv, ctxForCv)
      }
      return out
    })

    // 5. 分流
    if (containsJSX) {
      ctx.currentUnit.enrichmentConsts.push({
        name: isAbsolute ? constName : loopData.accessPath,
        value: enrichedData,
        containsJSX: true,
      })
    } else if (isAbsolute) {
      setNested(ctx.stateEntries, constName, enrichedData)
      ctx.currentUnit.bindingRefs.push({
        __node: true,
        type: 'binding',
        path: loopData.path,
        pathType: 'absolute' as const,
        accessPath: constName,
      })
    }

    // 记录 enrichment 映射（仅 absolute，relative 的 const 名在模板内用 accessPath）
    if (isAbsolute) {
      ctx.loopEnrichmentMap.set(`${parentNodeId}:${loop.template.componentName}`, { constName })
    }
  }

  // 6. 切到模板文件单元，继续走 template.body（inline 时走当前单元）
  const templateUnit = isInline ? ctx.currentUnit : getOrCreateUnit(ctx, `components/${loop.template.componentName}`)
  withUnit(ctx, templateUnit, () => {
    for (const child of loop.template.body) walk(child, ctx)
  })
}

// ─── 主入口 ───

export function buildState(mappedPage: MappedPage): StateBuilderResult {
  const ctx: StateBuilderContext = {
    rawState: mappedPage.state,
    iconNameMap: (mappedPage as any).iconNameMap ?? {},
    fileUnits: new Map(),
    currentUnit: null as any,
    stateEntries: {},
    loopEnrichmentMap: new Map(),
  }

  // 创建主文件单元
  ctx.currentUnit = getOrCreateUnit(ctx, 'main')

  // 走树
  walk(mappedPage.rootTree, ctx)

  // 本地资源路径泛路改写：stateEntries + 各文件单元 enrichmentConst 的值。
  // 覆盖所有 binding 值（绝对进 state.js、相对进 enrichment）+ CV.transform 返回的 URL。
  // （字面量 prop 已在 buildTrees #processValue 改写；此处只管 state 物化的值。）
  ctx.stateEntries = rewriteResourcePathsInValue(ctx.stateEntries)
  for (const unit of ctx.fileUnits.values()) {
    for (const ec of unit.enrichmentConsts) {
      ec.value = rewriteResourcePathsInValue(ec.value)
    }
  }

  // 生成 state.js
  const stateContent = generateStateFileContent(ctx.stateEntries)

  return {
    stateContent,
    newState: ctx.stateEntries,
    fileUnits: ctx.fileUnits,
    loopEnrichmentMap: ctx.loopEnrichmentMap,
  }
}
