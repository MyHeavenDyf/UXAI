/**
 * accessPath — 路径引用语义收拢
 *
 * accessPath 由 BuildTrees `#computeAccessPath` 产出：字段用 `.` 分隔、数字段用 `[n]` 紧跟字段
 * （`/a/b/0/c` → `a.b[0].c`）。
 *
 * 平面（无 `.` `[` `]`）vs 嵌套的处理规则统一收拢于此，stateBuilder / treeFinalizer /
 * jsxEmitter / fileAssembler 共用，避免各消费者 flat-only 假设在嵌套路径上翻车。
 *
 * 嵌套路径两类（都常见于对象型 A2UI state，如 brandInfo.logoIcon / pDetProduct.rating）：
 *   - 绝对嵌套：值在 state.js（setNested 写嵌套结构）→ 引用 `initialState.a.b`
 *   - 相对嵌套：值在循环项（enrichment 写嵌套位置）→ 模板 destructure 顶级字段 + 属性访问
 */

import type { ComputedValue } from './valueTypes'

/** accessPath 是否平面（无 `.` `[` `]`）→ 进文件顶部 destructure 为本地变量 */
export function isFlatAccessPath(ap: string | undefined | null): boolean {
  if (!ap) return false
  return !ap.includes('.') && !ap.includes('[') && !ap.includes(']')
}

/**
 * 绝对路径在 state.js 的引用形式（binding + 非 JSX computed 用，值在 state.js）。
 *
 * - 平面 → 裸 `ap`（文件顶部已 destructure 为本地变量，buildFileTopConsts 收 flat 路径）
 * - 嵌套 → `initialState.ap`（不 destructure，直接属性链访问 state.js 嵌套结构，setNested 保证结构）
 *
 * 之前 jsxEmitter / useStateRefName / routeLoopNode 各自 `ap.includes('.') → initialState.ap`，
 * 现统一调本函数。
 */
export function stateRef(ap: string): string {
  return isFlatAccessPath(ap) ? ap : `initialState.${ap}`
}

/**
 * containsJSX:true 绝对 computed 的文件顶部 const 名（合法 JS 标识符，小驼峰）。
 *
 * - 平面 accessPath 原样（如 `backIcon`）
 * - 嵌套 / 数组下标按 `.` `[` `]` 切段后小驼峰拼接：
 *   `brandInfo.logoIcon` → `brandInfoLogoIcon`；`a[0].b` → `a0B`
 *
 * stateBuilder（jsxLiteralConst 名）与 jsxEmitter（引用）共用，保证 const 名与引用一致。
 */
export function jsxConstName(accessPath: string | undefined | null): string {
  const name = accessPath ?? ''
  if (/^[A-Za-z_$][\w$]*$/.test(name)) return name
  const segs = name.split(/[\.\[\]]+/).filter(Boolean)
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
