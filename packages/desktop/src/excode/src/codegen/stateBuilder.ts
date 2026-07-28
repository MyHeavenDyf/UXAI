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

import type { MappedPage } from '../pipeline/pipelineContext'
import type { BuildNode, LoopNode, ExtractNode, RegularNode, LoopScope, RenderFnScope, Scope } from '../core/nodeTypes'
import type { BindingValue, ComputedValue, ComputedTransformCtx, PropValue } from '../core/valueTypes'
import { resolveIcon } from '../core/iconCollection'
import { collectRelativeCVs } from '../core/scopedEnrichment'
import { rewriteResourcePathsInValue } from '../core/resourcePath'
import { jsxConstName } from '../core/accessPath'
import { serializePlainJs } from './jsSerializer'

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

/** 按 accessPath 设嵌套值，支持数组下标：`a.b[0].c` → obj.a.b[0].c，保持原始结构。
 *  accessPath 来自 #computeAccessPath：字段用 `.` 分隔，数字段用 `[n]` 紧跟字段后。 */
function setNested(obj: Record<string, any>, key: string, value: any): void {
  const accessors = parseAccessors(key)
  let cur: any = obj
  for (let i = 0; i < accessors.length; i++) {
    const a = accessors[i]
    const isLast = i === accessors.length - 1
    if (a.kind === 'field') {
      if (isLast) { cur[a.field] = value; return }
      const wantArray = accessors[i + 1]?.kind === 'index'
      if (cur[a.field] == null || typeof cur[a.field] !== 'object') cur[a.field] = wantArray ? [] : {}
      cur = cur[a.field]
    } else {
      // index：cur 必为数组
      if (!Array.isArray(cur)) cur = []  // 防御
      if (isLast) { cur[a.index] = value; return }
      const wantArray = accessors[i + 1]?.kind === 'index'
      if (cur[a.index] == null || typeof cur[a.index] !== 'object') cur[a.index] = wantArray ? [] : {}
      cur = cur[a.index]
    }
  }
}

/** 拆 accessPath 为访问器序列：`a.b[0][1].c` → [field a, field b, index 0, index 1, field c] */
function parseAccessors(key: string): Array<{ kind: 'field'; field: string } | { kind: 'index'; index: number }> {
  const out: Array<{ kind: 'field'; field: string } | { kind: 'index'; index: number }> = []
  for (const part of key.split('.')) {
    const m = part.match(/^([^\[]*)((?:\[\d+\])*)$/)
    if (!m) continue
    const field = m[1]
    const indices = (m[2].match(/\[(\d+)\]/g) || []).map(s => parseInt(s.slice(1, -1), 10))
    if (field) out.push({ kind: 'field', field })
    for (const idx of indices) out.push({ kind: 'index', index: idx })
  }
  return out
}

function pathToSegments(path: string): string[] {
  return path.replace(/^\//, '').split('/').filter(Boolean)
}

function resolveBySegments(root: any, segments: string[]): any {
  let cur: any = root
  for (const seg of segments) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

/** 从 path 提取顶层 key 名 */
function pathToTopKey(path: string): string {
  const seg = path.replace(/^\//, '').split('/').filter(Boolean)[0]
  return seg || ''
}

/** 生成循环 enrichment const 名 */
function makeEnrichmentConstName(path: string, parentNodeId: string): string {
  return `${pathToTopKey(path)}_${parentNodeId}Enriched`
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

/** 从循环的 LoopScope 链解析数据源 */
function resolveLoopData(loop: LoopNode, ctx: StateBuilderContext): any[] {
  const data = loop.data as BindingValue  // state-builder 阶段 LoopNode.data 还是 BindingValue
  if (data.pathType === 'absolute') {
    const val = getValueFromState(ctx.rawState, data.path)
    return Array.isArray(val) ? val : (val != null ? [val] : [])
  }

  // relative：沿 Scope 链向上找到首个 absolute dataBinding（只认 LoopScope）
  let scope = loop.loopScope
  while (scope) {
    if ('loopNode' in scope) {
      const loopScope = scope as LoopScope
      const scopeData = loopScope.loopNode.data as BindingValue
      if (scopeData.pathType === 'absolute') {
        const arr = getValueFromState(ctx.rawState, scopeData.path)
        if (!Array.isArray(arr) || arr.length === 0) return []
        const firstItem = arr[0]
        const segments = pathToSegments(data.path)
        const val = resolveBySegments(firstItem, segments)
        return Array.isArray(val) ? val : (val != null ? [val] : [])
      }
    }
    scope = scope.parent
  }
  return []
}

/**
 * 通用相对路径解析：沿 Scope 链向上找到首个 absolute dataBinding，
 * 取其 [0] 作为根对象，按段解析目标路径。
 * RenderFnScope 跳过（其 paramBindings 不参与 scope 链的 loop 语义），继续沿 parent 向上。
 */
function resolveRelativeByScope(
  relPath: string,
  scope: Scope | undefined,
  rawState: Record<string, any>
): any {
  if (!scope) return undefined
  const segments = pathToSegments(relPath)
  // 沿 scope 链向上找首个 absolute dataBinding
  let curScope: Scope | undefined = scope
  while (curScope) {
    if ('loopNode' in curScope) {
      const loopScope = curScope as LoopScope
      const sd = loopScope.loopNode.data as BindingValue
      if (sd.pathType === 'absolute') {
        const arr = getValueFromState(rawState, sd.path)
        if (!Array.isArray(arr) || arr.length === 0) return undefined
        return resolveBySegments(arr[0], segments)
      }
    }
    curScope = curScope.parent
  }
  return undefined
}

/**
 * 构建 ComputedTransformCtx——供 ComputedValue.transform 在求值阶段使用。
 * @param scope 循环 scope（处理循环内的相对 computed 时传入；绝对 computed 时传 undefined）
 */
function buildTransformCtx(
  rawState: Record<string, any>,
  iconNameMap: Record<string, string>,
  scope?: Scope
): ComputedTransformCtx {
  return {
    rawState,
    resolveIcon: (name, props?) => resolveIcon(name, iconNameMap, props) as any,
    resolveValueFromPath: (path: string) => {
      if (!path) return undefined
      if (path.startsWith('/')) return getValueFromState(rawState, path)
      return resolveRelativeByScope(path, scope, rawState)
    },
  }
}

/** 从 body 中收集所有 relative ComputedValue（跳过嵌套 LoopNode） */
function collectRelativeComputeds(body: RegularNode[]): ComputedValue[] {
  return collectRelativeCVs(body)
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
// 语义已收拢到 core/accessPath.ts（jsxConstName / computedJsxConstName / stateRef / isFlatAccessPath），
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
  if (v.type === undefined && typeof v === 'object') {
    for (const item of Object.values(v)) consumeValue(item, ctx)
  }
}

// ─── processLoop ───

function processLoop(loop: LoopNode, ctx: StateBuilderContext, parentNodeId: string): void {
  // 1. 解析原始数据源
  const rawData = resolveLoopData(loop, ctx)
  if (rawData.length === 0) {
    console.warn(
      `  [warn] state-builder: 循环 "${loop.template.componentName}" 数据为空（path: ${(loop.data as BindingValue).path}），跳过 enrichment`
    )
    // 空数据 → 不产生 enrichment，走 body 即可
    const templateUnit = getOrCreateUnit(ctx, `components/${loop.template.componentName}`)
    withUnit(ctx, templateUnit, () => {
      for (const child of loop.template.body) walk(child, ctx)
    })
    return
  }

  // 2. 收集 template.body 内 relative ComputedValue
  const relativeCVs = collectRelativeComputeds(loop.template.body)
  const containsJSX = relativeCVs.some(cv => cv.containsJSX)

  const loopData = loop.data as BindingValue  // state-builder 阶段还是 BindingValue
  const constName = makeEnrichmentConstName(loopData.path, parentNodeId)

  // 数据源路径类型：absolute 走 state.js / enrichment，relative 由外层模板 data prop 解构
  const isAbsolute = loopData.pathType === 'absolute'

  // 3. 无 enrichment（无 relative computed）
  if (relativeCVs.length === 0) {
    if (isAbsolute) {
      setNested(ctx.stateEntries, loopData.accessPath, rawData)
      ctx.currentUnit.bindingRefs.push(loopData)
    }
    // relative → 不进 state.js，由外层模板从 data 解构
  } else {
    // 4. 做整体 enrichment
    // 4a. 去重：同一相对 path 可能绑定到模板内多个节点（如 Icon.name 与 Button.icon 都绑
    //     favoriteIcon），各自产出 path 相同的 ComputedValue。若都写 out[cv.path] 会撞键——
    //     后一个 CV 拿到前一个 CV 已写入的 JSX 产物（非原始字符串），transform 返回 null。
    //     处理：第一个 CV 保留原 key；后续撞键的 CV 生成新 key 并改写其 accessPath
    //     （jsx-emitter inTemplate 按 accessPath 序列化、collectRelativeFields 按 accessPath
    //     收集 destructure 字段），cv.path 保留原值用于读原始 item 数据。
    const usedKeys = new Set<string>()
    for (const cv of relativeCVs) {
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
      for (const cv of relativeCVs) {
        try {
          // 循环内 relative computed → ctx 带 loopScope 以便 resolveValueFromPath 沿链解析
          const ctxForCv = buildTransformCtx(ctx.rawState, ctx.iconNameMap, loop.loopScope)
          // 读原始值：cv.path 可能是嵌套相对路径（user/avatar），按 segments 解析；平面等价直接取。
          // 用原始 item 读（不被前一个 CV 产物污染）。
          const rawValue = resolveBySegments(item, pathToSegments(cv.path))
          // 写到 out：accessPath 去重后可能是嵌套（如 user.avatar_1），setNested 写嵌套位置。
          // 相对 accessPath 用 `/` 分隔（user/avatar），归一为 `.` 与 emit relPath 对齐。
          const writeKey = ((cv as any).accessPath ?? cv.path).replace(/\//g, '.')
          setNested(out, writeKey, cv.transform(rawValue, ctxForCv))
        } catch (err: any) {
          console.warn(`  [warn] state-builder: loop enrichment 失败 (path: ${cv.path}): ${err.message}`)
        }
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
      // 不含 JSX 且绝对路径 → 进 state.js，当前文件单元 destructure
      setNested(ctx.stateEntries, constName, enrichedData)
      ctx.currentUnit.bindingRefs.push({
        type: 'binding',
        path: loopData.path,
        pathType: 'absolute' as const,
        accessPath: constName,
      })
    }
    // relative 且不含 JSX → enrichment 数据不进 state.js（由外层模板 data prop 携带）

    // 记录 enrichment 映射（仅 absolute，relative 的 const 名在模板内用 accessPath）
    if (isAbsolute) {
      ctx.loopEnrichmentMap.set(`${parentNodeId}:${loop.template.componentName}`, { constName })
    }
  }

  // 6. 切到模板文件单元，继续走 template.body
  const templateUnit = getOrCreateUnit(ctx, `components/${loop.template.componentName}`)
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
