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
 *   stateBuilder.ts（替代内联的 collectRelativeComputeds）
 *   fileAssembler.ts（替代内联的 collectRelativeFields）
 *   jsxEmitter.ts（collectRelativeFields 用于 render fn destructure）
 */

import type {
  ComputedValue,
  BindingValue,
  RenderFnValue,
  RenderFnParam,
} from './valueTypes'
import { Value } from './value'
import type {
  BuildNode,
  RegularNode,
} from './nodeTypes'

// ─── collectRelativeCVs ───

/**
 * 从 body 中收集所有 relative ComputedValue（跳过嵌套 LoopNode）。
 * 等价于 stateBuilder.ts 中同名的内联函数，提取为公共共享。
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
        if (d.type === 'varRef' && typeof d.name === 'string' && !d.name.startsWith('initialState.')) {
          const seg = d.name.split(/[./]/)[0]
          if (seg) fields.add(seg)
        } else if ((d.type === 'binding' || d.type === 'computed') && d.pathType === 'relative') {
          const seg = (d.accessPath ?? d.path).split(/[./]/)[0]
          if (seg) fields.add(seg)
        }
      }
      return  // 不递归进 template body（内层模板有自己的 destructure）
    }
    for (const v of Object.values((n as any).props ?? {})) {
      if (v && typeof v === 'object' && ((v as any).type === 'binding' || (v as any).type === 'computed') && (v as any).pathType === 'relative') {
        // 同时按 `.` 和 `/` 分割取顶级字段（A2UI 路径用 `/`，旧 binding 可能用 `.`）
        const seg = ((v as any).accessPath ?? (v as any).path).split(/[./]/)[0]
        if (seg) fields.add(seg)
      }
    }
    // TextNode.value 也可能是相对 binding/computed（如 Icon 中 Fragment + Node.text 包装的动态 JSX）
    if ((n as any).kind === 'text') {
      const tv = (n as any).value
      if (tv && typeof tv === 'object' && ((tv as any).type === 'binding' || (tv as any).type === 'computed') && (tv as any).pathType === 'relative') {
        const seg = ((tv as any).accessPath ?? (tv as any).path).split(/[./]/)[0]
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

// ─── enrichScopedData ───

/**
 * 从已 resolve 的 body 节点中收集 relative ComputedValue，
 * 对数据源做整体 enrichment。
 *
 * 等价于 processLoop 的主体逻辑（对每项 map），但不涉及 template 文件拆分。
 * 返回的 ComputedValue 可直接作为 props.dataset 等数据 prop 的值。
 *
 * @param scopedBinding - 循环数据源（loop.data）
 * @param enrichedBodies - 已 resolve 的 body 节点（如 cells 数组），内部含 relative CV
 * @returns 带 enrichment 的 ComputedValue
 */
export function enrichScopedData(
  scopedBinding: BindingValue,
  enrichedBodies: BuildNode[],
): ComputedValue {
  const relativeCVs = collectRelativeCVs(enrichedBodies as RegularNode[])
  const containsJSX = relativeCVs.some(cv => cv.containsJSX)

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
        const out = { ...item }
        for (const cv of relativeCVs) {
          try {
            out[cv.path] = cv.transform(out[cv.path], cvCtx)
          } catch {
            // skip
          }
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
    type: 'renderFn',
    params,
    body,
  }
}
