/**
 * accessPath — 路径引用语义收拢
 *
 * accessPath 由 `pathToJsAccess` 产出：字段用 `.` 分隔、数字段用 `[n]` 紧跟字段
 * （`/a/b/0/c` → `a.b[0].c`）。
 *
 * 平面（无 `.` `[` `]`）vs 嵌套的处理规则统一收拢于此，stateBuilder / treeFinalizer /
 * jsxEmitter / fileAssembler 共用，避免各消费者 flat-only 假设在嵌套路径上翻车。
 *
 * 嵌套路径两类（都常见于对象型 A2UI state，如 brandInfo.logoIcon / pDetProduct.rating）：
 *   - 绝对嵌套：值在 state.js（setNested 写嵌套结构）→ 引用 `initialState.a.b`
 *   - 相对嵌套：值在循环项（enrichment 写嵌套位置）→ 模板 destructure 顶级字段 + 属性访问
 */

import type { ComputedValue } from './value-types'
import { parseAccessors } from './state-path'

/**
 * 将 JSON Pointer 路径转为 JS 属性访问表达式。
 *
 * - 绝对路径 `/a/b/0/c` → `a.b[0].c`
 * - 相对路径 `field/0/0/label` → `field[0][0].label`
 * - 平面路径 `name` → `name`
 *
 * 数字段用 `[n]`（数组索引），字符串段用 `.name`。
 * 用于 emitValue（relPath）和 stateBuilder（writeKey）等需要产 JS 代码的位置。
 * 不改变 accessPath 的存储格式（保留 `/` 以兼容 collectRelativeFields / resolveBySegments）。
 */
export function pathToJsAccess(path: string): string {
  const segments = path.replace(/^\//, '').split('/').filter(Boolean)
  if (segments.length === 0) return ''
  let r = segments[0]
  for (let i = 1; i < segments.length; i++) {
    r += /^\d+$/.test(segments[i]) ? `[${segments[i]}]` : `.${segments[i]}`
  }
  return r
}

// ─── 合法标识符判定（state key 可含 `-` 等特殊字符，emit 时需 bracket 访问）───

const IDENT_RE = /^[A-Za-z_$][\w$]*$/

/** 是否合法 JS 标识符（可作本地变量名 / `.seg` 访问段）。 */
export function isValidIdentifier(s: string): boolean {
  return IDENT_RE.test(s)
}

/**
 * 把 stored accessPath（`a.b[0].c` 格式，段名可含 `-` 等非标识符字符）转为合法 JS 成员访问表达式。
 *
 * - base 给定 → `base.field["b-c"][0].d`
 * - base 省略 → 首段裸（仅当首段是合法标识符，即已被 destructure 为本地变量；调用方契约）
 *
 * 合法标识符段用 `.seg`，非标识符段用 `["seg"]`（JSON-quote），数字段用 `[n]`。
 * 复用 state-path 的 parseAccessors（access-path → state-path 单向依赖，无环）。
 *
 * 用途：stateRef（绝对引用，base='initialState'）、bindingRef relative（base=loopVar / 'data' / renderFnDataVarName）。
 * accessPath 存储格式（pathToJsAccess 产）不变，本函数只在 emit 期转译。
 */
export function accessPathToJsExpr(accessPath: string, base?: string): string {
  const accessors = parseAccessors(accessPath)
  if (accessors.length === 0) return base ?? ''
  let r = base ?? ''
  let first = base === undefined
  for (const a of accessors) {
    if (a.kind === 'index') {
      r += `[${a.index}]`
      first = false
    } else {
      if (first) {
        // 无 base：首段裸（调用方保证首段是已 destructure 的合法标识符本地变量）
        r += a.field
        first = false
      } else {
        r += isValidIdentifier(a.field) ? `.${a.field}` : `[${JSON.stringify(a.field)}]`
      }
    }
  }
  return r
}

/**
 * accessPath 是否平面 → 进文件顶部 destructure 为本地变量。
 *
 * 平面（无 `.` `[` `]`）且单段是合法 JS 标识符 → true。
 * 含特殊字符的平面路径（如 `a-b`）返回 false：不能作本地变量名 / `.seg` 访问，
 * 改由 stateRef 用 bracket `initialState["a-b"]` 引用，不进 destructure。
 */
export function isFlatAccessPath(ap: string | undefined | null): boolean {
  if (!ap) return false
  if (ap.includes('.') || ap.includes('[') || ap.includes(']')) return false
  return isValidIdentifier(ap)
}

/**
 * 绝对路径在 state.js 的引用形式（binding + 非 JSX computed 用，值在 state.js）。
 *
 * - 平面且合法标识符 → 裸 `ap`（文件顶部已 destructure 为本地变量，buildFileTopConsts 收 flat 路径）
 * - 嵌套 / 含非标识符段 → `accessPathToJsExpr(ap, 'initialState')`
 *   （`a-b`→`initialState["a-b"]`；`a.b-c`→`initialState.a["b-c"]`；`a.b`→`initialState.a.b`）
 *
 * 之前 jsxEmitter / useStateRefName / routeLoopNode 各自 `ap.includes('.') → initialState.ap`，
 * 现统一调本函数。
 */
export function stateRef(ap: string): string {
  if (isFlatAccessPath(ap)) return ap
  return accessPathToJsExpr(ap, 'initialState')
}

/**
 * containsJSX:true 绝对 computed 的文件顶部 const 名（合法 JS 标识符，小驼峰）。
 *
 * - 平面合法标识符 accessPath 原样（如 `backIcon`）
 * - 含非标识符字符（`.` `[` `]` `-` 等）按非标识符字符切段后小驼峰拼接：
 *   `brandInfo.logoIcon` → `brandInfoLogoIcon`；`a[0].b` → `a0B`；`a-b` → `aB`；`a.b-c` → `aBC`
 *
 * stateBuilder（jsxLiteralConst 名）与 jsxEmitter（引用）共用，保证 const 名与引用一致。
 */
export function jsxConstName(accessPath: string | undefined | null): string {
  const name = accessPath ?? ''
  if (isValidIdentifier(name)) return name
  // 按任意非标识符字符（. [ ] - 等）切段，小驼峰拼接；纯数字段保留
  const segs = name.split(/[^A-Za-z0-9_$]+/).filter(Boolean)
  if (segs.length === 0) return 'jsxConst'
  const lowerFirst = (s: string) => s ? s.charAt(0).toLowerCase() + s.slice(1) : s
  const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
  const first = lowerFirst(segs[0])
  const rest = segs.slice(1).map(s => /^\d+$/.test(s) ? s : cap(s))
  return first + rest.join('')
}

/**
 * containsJSX:true 绝对 computed 的引用（const 名，裸）。
 *
 * 与 stateBuilder `makeComputedKey` 一致：优先 identResolver，否则 jsxConstName(accessPath)。
 * stateBuilder（push jsxLiteralConst 名）与 jsxEmitter（emit 引用）共用，保证一致。
 */
export function computedJsxConstName(cv: ComputedValue): string {
  if (cv.identResolver) {
    return cv.identResolver({
      defaultName: cv.accessPath,
      sourceType: 'computed',
      componentName: cv.componentName,
      propKey: (cv as any).propKey,
      nodeId: (cv as any).nodeId,
    })
  }
  return jsxConstName(cv.accessPath)
}

/**
 * CSS Modules 引用：合法 JS 标识符用 `styles.id`，含特殊字符（如 `-`）用 `styles['id']`。
 * 避免产物 `styles.root-page` 被当减法。
 */
export function cssModuleRef(varName: string, id: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)
    ? `${varName}.${id}`
    : `${varName}[${JSON.stringify(id)}]`
}

/**
 * path 的顶级字段（去前导 / 后首段）。如 `/a/b` → `a`；`masQuickLinks/3` → `masQuickLinks`。
 * 仅供 makeEnrichmentConstName 用。
 */
function pathToTopKey(path: string): string {
  const seg = path.replace(/^\//, '').split('/').filter(Boolean)[0]
  return seg || ''
}

/**
 * enrichment const 名（stateBuilder 写 const / treeFinalizer 读 loopEnrichmentMap，共用保证一致）。
 * 格式：`${pathToTopKey(path)}_${parentNodeId}Enriched`。
 */
export function makeEnrichmentConstName(path: string, parentNodeId: string): string {
  return `${pathToTopKey(path)}_${parentNodeId}Enriched`
}
