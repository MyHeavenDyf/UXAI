/**
 * scoped-enrichment — 作用域子树 enrichment 工具
 *
 * 解决"循环数据源 + render fn body"场景下对数据源做整体 enrichment 的需求。
 *
 * 核心函数：
 *   enrichScopedData     — 收集 bodies 中的 relative ComputedValue，对数据源逐项做 enrichment
 *   buildRenderFn        — 构建 RenderFnValue（结构化 params）
 *   collectRelativeCVs   — 从节点树收集 relative ComputedValue
 *   collectRelativeFields— 从节点树收集相对 binding 的顶级字段名（destructure 用）
 *
 * 使用方：
 *   table.ts, timeline.ts, 等映射文件
 *   state-builder.ts（替代内联的 collectRelativeComputeds）
 *   file-assembler.ts（替代内联的 collectRelativeFields）
 *   jsx-emitter.ts（collectRelativeFields 用于 render fn destructure）
 */

import type {
  ComputedValue,
  BindingValue,
  RenderFnValue,
  RenderFnParam,
  OverrideStore,
} from './value-types'
import { Value } from './value-factory'
import type {
  BuildNode,
  RegularNode,
} from './node-types'
import { pathToJsAccess } from './access-path'
import { pathToSegments, resolveBySegments, setNested } from './state-path'

// ─── collectRelativeCVs ───

/**
 * 从 body 中收集所有 relative ComputedValue（跳过嵌套 LoopNode）。
 * 等价于 state-builder.ts 中同名的内联函数，提取为公共共享。
 */
export function collectRelativeCVs(body: RegularNode[]): ComputedValue[] {
  const out: ComputedValue[] = []
  const walk = (n: RegularNode): void => {
    // 跳过嵌套循环（由内层自己处理）
    if ((n as any).kind === 'loop') return

    // ComponentNode / HtmlNode 的 props
    for (const v of Object.values((n as any).props ?? {})) {
      if (v && typeof v === 'object' && (v as any).type === 'computed' && (v as any).pathType === 'relative') {
        out.push(v as ComputedValue)
      }
    }

    // TextNode 的 value 也可能是 ComputedValue（Fragment + Node.text 包装的动态 JSX）
    if ((n as any).kind === 'text') {
      const v = (n as any).value
      if (v && typeof v === 'object' && v.type === 'computed' && v.pathType === 'relative') {
        out.push(v as ComputedValue)
      }
    }

    // children 递归
    if ((n.kind === 'component' || n.kind === 'html') && Array.isArray((n as any).children)) {
      for (const c of (n as any).children) walk(c as RegularNode)
    }
  }
  for (const n of body) walk(n)
  return out
}

// ─── collectRelativeFields ───

/** 取 accessPath / varRef name 的顶级字段（JS 访问首段，按 `.` `[` `]` 分隔）。
 *  accessPath 是 JS 形式（无 `/`，pathToJsAccess 产），故 split 不含 `/`。 */
function topField(p?: string): string {
  return p ? (p.split(/[\.\[\]]/)[0] ?? '') : ''
}

/**
 * 从节点树收集所有相对 binding 的顶级字段名（destructure 用）。
 * 例：body 内有 `{ path: 'user.email' }` 和 `{ path: 'name' }` → Set('user', 'name')
 */
export function collectRelativeFields(root: BuildNode): Set<string> {
  const fields = new Set<string>()
  const walk = (n: BuildNode): void => {
    if (n.kind === 'loop') {
      // 内层循环的 data 若是相对引用，外层模板要 destructure 该字段才能在 .map 里引用
      // （如外层 item 的 tags 数组：{(tags || []).map(...)}）。
      // tree-finalizer 后 loop.data 多为 VarRefValue（裸 accessPath）；相对 → 裸名，
      // 绝对嵌套 → initialState.xxx（不带 destructure），故只收非 initialState. 前缀的裸名。
      const d = (n as any).data
      if (d && typeof d === 'object' && !d.kind) {  // 值类，非 BuildNode
        // varRef：仅 relative（外层 item 字段）才进外层 destructure；
        // absolute（顶层 state/const，如嵌套循环的绝对路径数据源）跳过——
        // 否则外层会错误地 `const { stlTabsItemTabs } = item` 解构顶层字段。
        if (d.type === 'varRef' && typeof d.name === 'string' && !d.name.startsWith('initialState.') && d.pathType !== 'absolute') {
          const seg = topField(d.name)
          if (seg) fields.add(seg)
        } else if ((d.type === 'binding' || d.type === 'computed') && d.pathType === 'relative') {
          const seg = topField(d.accessPath ?? d.path)
          if (seg) fields.add(seg)
        }
      }
      return  // 不递归进 template body（内层模板有自己的 destructure）
    }
    for (const v of Object.values((n as any).props ?? {})) {
      if (v && typeof v === 'object' && ((v as any).type === 'binding' || (v as any).type === 'computed') && (v as any).pathType === 'relative') {
        // 按 JS accessor 全分隔符（. [ ] /）取顶级字段
        const seg = topField((v as any).accessPath ?? (v as any).path)
        if (seg) fields.add(seg)
      }
    }
    // TextNode.value 也可能是相对 binding/computed（如 Icon 中 Fragment + Node.text 包装的动态 JSX）
    if ((n as any).kind === 'text') {
      const tv = (n as any).value
      if (tv && typeof tv === 'object' && ((tv as any).type === 'binding' || (tv as any).type === 'computed') && (tv as any).pathType === 'relative') {
        const seg = topField((tv as any).accessPath ?? (tv as any).path)
        if (seg) fields.add(seg)
      }
    }
    if ((n.kind === 'component' || n.kind === 'html')) {
      const ch = (n as any).children
      // children 可能是 LoopNode 直接挂（不在数组里）——要走进去收集 loop.data 的相对字段
      if (ch && ch.kind === 'loop') {
        walk(ch as BuildNode)
      } else if (Array.isArray(ch)) {
        for (const c of ch) walk(c as BuildNode)
      }
    }
  }
  walk(root)
  return fields
}

// ─── collectRelativeCVsDeep（enrichScopedData 专用） ───

export interface ScopedCV {
  cv: ComputedValue
  /**
   * 外层循环 data 路径链（accessPath），从外到内。
   * 空 = CV 直接在数据源项上（如 row.title）；['actions'] = CV 在 row.actions[i] 上。
   */
  loopChain: string[]
  /**
   * 持有该 CV 的所属节点（component/html）。override 旁路据此把 tag/import 应用到对的节点。
   * TextNode 的 value CV 不带 ownerNode（文本节点无 tag/import，override 无意义）。
   */
  ownerNode?: BuildNode
}

/**
 * 深度收集 body 中的 relative ComputedValue，深入嵌套 LoopNode 的 template body，
 * 每个 CV 带上其外层循环 data 路径链（loopChain），供 enrichScopedData 沿链逐层 map 应用。
 *
 * 区别于 collectRelativeCVs（浅、跳过循环，供 stateBuilder processLoop 处理正常嵌套循环）：
 * enrichScopedData 的数据源是外层数据（如 Table 的 twoWorkorderList），内层循环（如 actions）
 * 的 CV 需应用到 row.actions[i] 上 → 必须深入并记录 loopChain。
 */
export function collectRelativeCVsDeep(body: RegularNode[]): ScopedCV[] {
  const out: ScopedCV[] = []
  const walk = (n: any, chain: string[]): void => {
    if (!n) return
    // ComponentNode / HtmlNode 的 props（当前层 CV）——ownerNode 记为 n
    for (const v of Object.values(n.props ?? {})) {
      if (v && typeof v === 'object' && (v as any).type === 'computed' && (v as any).pathType === 'relative') {
        out.push({ cv: v as ComputedValue, loopChain: chain, ownerNode: n })
      }
    }
    // TextNode 的 value 也可能是 ComputedValue——无 ownerNode（文本节点无 tag/import）
    if (n.kind === 'text') {
      const v = n.value
      if (v && typeof v === 'object' && (v as any).type === 'computed' && (v as any).pathType === 'relative') {
        out.push({ cv: v as ComputedValue, loopChain: chain })
      }
    }
    // children：loop → 只深入 relative 循环（数据是外层 item 的子字段）；
    // absolute 循环数据是顶层 state，不属于外层 item，不深入（由内层自己的 processLoop 处理）。
    // 数组 → 递归
    if (n.kind === 'component' || n.kind === 'html') {
      const ch = n.children
      if (ch && ch.kind === 'loop') {
        const d = ch.data
        if (d && typeof d === 'object' && d.pathType === 'relative') {
          const loopPath = d.accessPath ?? d.path
          const newChain = loopPath ? [...chain, loopPath] : chain
          for (const c of ch.template?.body ?? []) walk(c, newChain)
        }
        // absolute → 不深入
      } else if (Array.isArray(ch)) {
        for (const c of ch) walk(c, chain)
      }
    }
  }
  for (const n of body) walk(n, [])
  return out
}

// ─── 嵌套 enrichment 辅助（内联；core 层不反向依赖 codegen/stateBuilder） ───


// ─── override 应用（共享：state-builder 调用点 1 + applyScopedCV 调用点 2 共用） ───

/**
 * 把 OverrideStore 应用到所属节点：tag/import 改写 + props 删除/改名。
 * 应用顺序：tag/import → deleteProps → renameProps（delete 先于 rename，避免改名后被误删）。
 * opt-in：未提供的字段不碰；node/override 缺省则 no-op。
 */
export function applyOverrideToNode(node: BuildNode | undefined, override: OverrideStore | undefined): void {
  if (!node || !override) return
  if (override.tag) (node as any).tag = override.tag
  if (override.import) (node as any).import = override.import
  const props = (node as any).props
  if (props && typeof props === 'object') {
    if (Array.isArray(override.deleteProps)) {
      for (const k of override.deleteProps) delete props[k]
    }
    if (override.renameProps) {
      for (const [oldKey, newKey] of Object.entries(override.renameProps)) {
        if (oldKey in props) {
          props[newKey] = props[oldKey]
          delete props[oldKey]
        }
      }
    }
  }
}

/**
 * 沿 loopChain 逐层 map 进嵌套循环数据数组，最里层应用 cv：
 *   loopChain 空 → obj[cv.accessPath] = cv.transform(obj[cv.path])
 *   loopChain=['actions', ...] → 对 obj.actions 每项递归（剥一层）
 *   （如 row.actions[i].icon = resolveIcon(row.actions[i].icon)）
 *
 * override 旁路（调用点 2：相对路径 CV）：传 ownerNode + overrideStore 时，
 * 在 leaf 把 cvCtx.override seed 为该 per-CV store（save/restore 隔离外层 CV 的 override，
 * 如 dataset 外层 CV 在调用点 1 的 override），跑完 transform 回读（兼容「原地改写」与
 * 「整体赋值」两种写法），把 tag/import/renameProps/deleteProps 累积进 store，
 * 由 applyOverrideToNode 应用到 ownerNode。per-item idempotent，
 * uniform 数据 → uniform override。不传 ownerNode/store（如 enrichScopedData 的内联 CV）
 * 则维持原行为，无 override。
 */
export function applyScopedCV(
  obj: any,
  loopChain: string[],
  cv: ComputedValue,
  cvCtx?: any,
  ownerNode?: BuildNode,
  overrideStore?: OverrideStore,
): void {
  if (obj == null || typeof obj !== 'object') return
  // 更新 currentItem 为当前 obj（transform 内 resolveValueFromPath(relative) 从此项解析）
  if (cvCtx) cvCtx.currentItem = obj
  if (loopChain.length === 0) {
    try {
      const rawValue = resolveBySegments(obj, pathToSegments(cv.path))
      const writeKey = pathToJsAccess(cv.accessPath ?? cv.path)
      // override 旁路：save/restore cvCtx.override，隔离外层 CV
      const prevOverride = cvCtx?.override
      if (cvCtx && overrideStore) cvCtx.override = overrideStore
      const result = cv.transform(rawValue, cvCtx)
      if (cvCtx && overrideStore) {
        // read-back：transform 可能「整体赋值」（cvCtx.override 指向新对象）或「原地改写」（store 本体）
        const written = cvCtx.override
        if (written && written !== overrideStore) {
          if (written.tag) overrideStore.tag = written.tag
          if (written.import) overrideStore.import = written.import
          if (written.renameProps) overrideStore.renameProps = written.renameProps
          if (written.deleteProps) overrideStore.deleteProps = written.deleteProps
        }
        cvCtx.override = prevOverride
      }
      setNested(obj, writeKey, result)
      // 应用到所属节点（per-item idempotent；uniform 数据 → uniform override）
      if (ownerNode && overrideStore) applyOverrideToNode(ownerNode, overrideStore)
    } catch {
      // skip 单个 CV 失败不影响其余
    }
    return
  }
  const arr = resolveBySegments(obj, pathToSegments(loopChain[0]))
  if (Array.isArray(arr)) {
    const rest = loopChain.slice(1)
    for (const sub of arr) applyScopedCV(sub, rest, cv, cvCtx, ownerNode, overrideStore)
  }
}

// ─── enrichScopedData ───

/**
 * 从已 resolve 的 body 节点中深度收集 relative ComputedValue（含嵌套循环内），
 * 对数据源逐项做嵌套 enrichment。
 *
 * 等价于 processLoop 的主体逻辑（对每项 map），但不涉及 template 文件拆分，
 * 且能处理 body 内的嵌套循环（循环套循环）：内层循环的 CV 沿 loopChain 应用到
 * row.innerArr[i] 上。返回的 ComputedValue 可直接作为 props.dataset 等数据 prop 的值。
 *
 * containsJSX 由收集到的 CV 决定：任一含 JSX → 整个数据源归属文件单元 jsxLiteralConsts
 * （不进 state.js），由 stateBuilder 分流。
 *
 * @param scopedBinding - 循环数据源（loop.data / dataSource）
 * @param enrichedBodies - 已 resolve 的 body 节点（如 cells 数组），内部含 relative CV
 * @returns 带 enrichment 的 ComputedValue
 */
export function enrichScopedData(
  scopedBinding: BindingValue,
  enrichedBodies: BuildNode[],
): ComputedValue {
  const scopedCVs = collectRelativeCVsDeep(enrichedBodies as RegularNode[])
  const containsJSX = scopedCVs.some(({ cv }) => cv.containsJSX)

  return Value.computed({
    path: scopedBinding.path,
    pathType: scopedBinding.pathType,
    accessPath: scopedBinding.accessPath,
    containsJSX,
    stateValue: scopedBinding.stateValue,
    transform: (rawData: any, cvCtx?: any) => {
      if (!Array.isArray(rawData)) return []
      return rawData.map((item: any) => {
        if (item === null || typeof item !== 'object') return item
        // deep clone：setNested 写嵌套路径会改 sub-object，shallow copy 会污染 rawState
        const out = structuredClone(item)
        for (const { cv, loopChain } of scopedCVs) {
          applyScopedCV(out, loopChain, cv, cvCtx)
        }
        return out
      })
    },
  })
}

// ─── buildRenderFn ───

/**
 * 构造 RenderFnValue。
 * params 已结构化，管线自动识别 dataSource 建立作用域。
 */
export function buildRenderFn(
  body: BuildNode | BuildNode[],
  params: RenderFnParam[],
): RenderFnValue {
  return {
    __node: true,
    type: 'renderFn',
    params,
    body,
  }
}
