/**
 * style-converter — BuildNode 树提取 Tailwind 类名 → LESS 规则
 *
 * 设计：
 *   1. collectRules(node) → 提取 LessRule[]
 *   2. generateLess(rules) → 生成 LESS 字符串（每文件 .module.less / .less）
 *
 * 节点已是 typed BuildNode（kind:'component'|'html'|'text'|'extract'），
 * 直接按 kind 分发，无需任何 nodeType marker。
 */

// ─── tailwind → CSS 转换器 ──────────────────────────────────
// CLI 模式用（tailwindcss v4 __unstable__loadDesignSystem 本地实现）
// import { convertTailwindToCSS } from '../../../lib/convertTailwindToCSS'
// Electron 模式用（引用 Electron 主进程已有模块）
import { convertTailwindToCSSGrouped, type GroupedCSS } from '../../../main/tailwind-to-css'
// ────────────────────────────────────────────────────────────

import type { BuildNode, ComponentNode, HtmlNode, LoopNode, RegularNode } from '../core/node-types'
import type { PropValue } from '../core/value-types'
import type { PendingExtractedFile } from './tree-finalizer'
import { rewriteCssUrlPaths } from '../core/resource-path'

/** ─── 手动开关 ─── */
/** 是否使用 CSS Modules（*.module.less）。可在调用方覆盖。 */
const USE_CSS_MODULES_DEFAULT = true

// ─── 产出物 ───

export interface StyleDeclaration {
  prop: string
  value: string
}

// 一条 LESS 规则：base 选择器 + base 声明 + 各 variant（已折叠好选择器、带媒体查询列表）。
export interface LessRule {
  selector: string
  declarations: StyleDeclaration[]
  variants?: { selector: string; mediaQueries: string[]; declarations: StyleDeclaration[] }[]
}

export interface LessFile {
  path: string
  content: string
}

export interface StyleResult {
  pageName: string
  /** 主页面 + 每个 module 抽取的 less 产物 */
  lessFiles: LessFile[]
  pageRules: LessRule[]
  moduleRules: Record<string, LessRule[]>
  styleStats: {
    totalClasses: number
    recognizedCount: number
    unrecognizedCount: number
    unrecognizedOccurrences: number
    unrecognizedClasses: string[]
  }
}

function fileExt(css: boolean): string {
  return css ? 'module.less' : 'less'
}

// ─── StyleConverter ───

export class StyleConverter {
  #totalClasses = 0
  #unrecognizedOccurrences = 0
  #unrecognized = new Set<string>()
  #classFreq = new Map<string, number>()
  #checked = new Set<string>()

  convertPage(
    pageName: string,
    rootTree: BuildNode,
    extractedFiles: PendingExtractedFile[],
    options: { cssModules?: boolean } = {}
  ): StyleResult {
    const useCssModules = options.cssModules ?? USE_CSS_MODULES_DEFAULT
    this.#reset()

    // 主页面规则
    const pageRules: LessRule[] = []
    this.#collectRules(rootTree, pageRules)

    // 每个 purpose === 'module' / 'component' 的抽取文件都产 less
    const moduleRules: Record<string, LessRule[]> = {}
    const lessFiles: LessFile[] = []
    const ext = fileExt(useCssModules)

    // 主页面 less（PascalCase 文件名，与组件保持一致）
    const mainFileName = toPascalCase(pageName)
    lessFiles.push({
      path: `src/pages/${pageName}/styles/${mainFileName}.${ext}`,
      content: generateLessContent(pageRules),
    })

    // 抽取（module / loop template 各自产 less）
    for (const ef of extractedFiles) {
      if (ef.purpose !== 'module' && ef.purpose !== 'component') continue
      const root: BuildNode | undefined = ef.body[0]
      if (!root) continue
      const rules: LessRule[] = []
      this.#collectRules(root, rules)
      moduleRules[ef.componentName] = rules
      lessFiles.push({
        path: `src/pages/${pageName}/styles/${ef.componentName}.${ext}`,
        content: generateLessContent(rules),
      })
    }

    // 未识别类警告
    if (this.#unrecognized.size > 0) {
      console.log(`\n  [样式告警] 页面 "${pageName}" 有 ${this.#unrecognized.size} 个未识别 Tailwind 类:`)
      for (const cls of [...this.#unrecognized].sort()) {
        console.log(`    ⚠  ${cls}`)
      }
    }

    return {
      pageName,
      lessFiles,
      pageRules,
      moduleRules,
      styleStats: {
        totalClasses: this.#totalClasses,
        recognizedCount: this.#totalClasses - this.#unrecognizedOccurrences,
        unrecognizedCount: this.#unrecognized.size,
        unrecognizedOccurrences: this.#unrecognizedOccurrences,
        unrecognizedClasses: [...this.#unrecognized].sort(),
      },
    }
  }

  // ── 内部 ──

  #reset(): void {
    this.#totalClasses = 0
    this.#unrecognizedOccurrences = 0
    this.#unrecognized.clear()
    this.#classFreq.clear()
    this.#checked.clear()
  }

  /**
   * 递归收集 LESS 规则
   * - 节点 id 不存在 → 不生成规则（jsx-emitter 也不给它 _style），但仍递归 children
   * - className 不是字符串 → 跳过该节点规则生成，children 仍递归
   */
  #collectRules(node: BuildNode, out: LessRule[]): void {
    if (!node) return

    if (node.kind === 'component' || node.kind === 'html') {
      const id = node.id
      const cn = readPropClassName(node.props)
      // chart（tag='Chart'）尺寸加 !important，压过组件默认 `.aui3_1 .ev-chart { width; height }`（两类选择器）
      const isChart = (node as any).tag === 'Chart'

      // 所有 variant（响应式 / 伪类 / dark / rtl 等）统一走 buildRule：
      // safeConvertGrouped 返回 base + variants，generateLessContent 再展开为嵌套规则
      if (id && cn) {
        const rule = buildRule(`.${id}`, safeConvertGrouped(cn), isChart)
        if (rule) out.push(rule)
      }

      // walk prop 值里嵌入的 BuildNode（如 IconButton.iconName 的 icon）——
      // icon 的 className 在 prop 值内，主树 children 走不到，此处补收。
      if (node.props) {
        for (const v of Object.values(node.props)) collectRulesFromValue(v as PropValue, out)
      }
    }

    // 递归 children
    if (node.kind === 'component' || node.kind === 'html') {
      const children = (node as ComponentNode | HtmlNode).children
      this.#recurChildren(children, out)
    } else if (node.kind === 'extract') {
      for (const c of node.body) this.#collectRules(c, out)
    }
  }

  #recurChildren(children: RegularNode[] | LoopNode | null | undefined, out: LessRule[]): void {
    if (!children) return
    if ((children as any).kind === 'loop') {
      const ln = children as LoopNode
      for (const c of ln.template.body) this.#collectRules(c, out)
      return
    }
    if (Array.isArray(children)) {
      for (const c of children) this.#collectRules(c, out)
      return
    }
    void out
  }
}

// ─── 工具函数 ───

/**
 * 从 props.className 读出字符串。非字符串（varRef 等）返回 null。
 */
function readPropClassName(props: Record<string, PropValue> | undefined): string | null {
  if (!props) return null
  const v = props.className
  if (typeof v !== 'string') return null
  if (!v.trim()) return null
  return v
}

// safeConvert 的 grouped 版本：先改写 className 里的本地资源 url()，再转 grouped（base + variants）。
// 失败时返回空结果不抛出，保证代码生成不因单个 className 中断。
function safeConvertGrouped(cn: string): GroupedCSS {
  try {
    const rewritten = rewriteCssUrlPaths(cn)
    return convertTailwindToCSSGrouped(rewritten, true)
  } catch {
    return { base: {}, variants: [] }
  }
}

/**
 * 由 grouped 转换结果构造一条 LESS 规则：base 声明 + 各 variant（伪类 / 媒体查询 / 组合）。
 * chart（isChart=true）的尺寸声明加 !important，压过组件默认 .ev-chart。
 */
function buildRule(selector: string, grouped: GroupedCSS, isChart: boolean): LessRule | null {
  // 折叠伪类到选择器：pseudos 按外->内顺序，把每段的 & 逐层替换为外层结果。
  //   [&:hover]              -> .id:hover
  //   [&:hover, &:focus]     -> .id:hover:focus
  //   [&:is(.group:hover *)] -> .id:is(.group:hover *)
  //   ["[dir=rtl] &"]        -> [dir=rtl] .id
  const foldPseudos = (pseudos: string[]) =>
    pseudos.reduce<string>((sel, p) => p.split('&').join(sel), selector)
  const apply = (decls: StyleDeclaration[]) => (isChart ? withSizingImportant(decls) : decls)
  const baseDecls = apply(styleObjToDecls(grouped.base))
  // 每个 variant 折叠出最终选择器，保留 mediaQueries 供 generateLessContent 包 @media
  const variants = grouped.variants
    .map(v => ({
      selector: foldPseudos(v.pseudos),
      mediaQueries: v.mediaQueries,
      declarations: apply(styleObjToDecls(v.props)),
    }))
    .filter(v => v.declarations.length > 0)
  if (baseDecls.length === 0 && variants.length === 0) return null
  return { selector, declarations: baseDecls, variants }
}

function styleObjToDecls(styleObj: Record<string, string>): StyleDeclaration[] {
  return Object.entries(styleObj).map(([k, v]) => ({
    prop: camelToKebab(k),
    value: v,
  }))
}

/**
 * 给尺寸类声明（width/height 及 min/max 变体）加 !important。
 * 仅用于 chart：eview-react Chart 外层默认 `.aui3_1 .ev-chart { width; height }` 是两类选择器 (0,2,0)，
 * 单类 `.audTrdChart` (0,1,0) 压不过；chart 的尺寸由 A2UI className 控制，加 !important 保证生效。
 */
function withSizingImportant(decls: StyleDeclaration[]): StyleDeclaration[] {
  return decls.map(d => {
    const p = d.prop.toLowerCase()
    return (p === 'width' || p === 'height' || p.endsWith('-width') || p.endsWith('-height'))
      ? { ...d, value: `${d.value} !important` }
      : d
  })
}

function camelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase()
}

export function generateLessContent(rules: LessRule[]): string {
  const lines: string[] = []
  lines.push('// Auto-generated by a2ui-transformer')
  lines.push('')
  for (const rule of rules) {
    if (rule.declarations.length > 0) {
      lines.push(`${rule.selector} {`)
      for (const decl of rule.declarations) lines.push(`  ${decl.prop}: ${decl.value};`)
      lines.push('}')
      lines.push('')
    }
    // variant 输出：纯伪类直接出 selector{}；带媒体查询的包成 @media q1 and q2 { selector{} }
    //   多个 mediaQueries 用 and 合并，如 @media (hover: hover) and (width >= 64rem)
    for (const v of rule.variants ?? []) {
      const indent = v.mediaQueries.length > 0 ? '  ' : ''
      if (v.mediaQueries.length > 0) lines.push(`@media ${v.mediaQueries.join(' and ')} {`)
      lines.push(`${indent}${v.selector} {`)
      for (const decl of v.declarations) lines.push(`${indent}  ${decl.prop}: ${decl.value};`)
      lines.push(`${indent}}`)
      if (v.mediaQueries.length > 0) lines.push('}')
      lines.push('')
    }
  }
  return lines.join('\n')
}

/**
 * 任意命名 → PascalCase（首字母大写，分隔符 - 或 _ 或空格）。
 *   orderAdmin          → OrderAdmin
 *   user-profile        → UserProfile
 *   mCnListItem         → MCnListItem
 *   my_app              → MyApp
 */
export function toPascalCase(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

/**
 * 把 less file path 反查为 jsx file path，并给出 jsx 内应写的相对 import 路径。
 *
 * lessFiles.path 形如：
 *   'src/pages/{pageName}/styles/{PascalName}.module.less'  (CSS Modules)
 *   'src/pages/{pageName}/styles/{PascalName}.less'           (全局)
 *
 * 对应 jsx（每个都用自己的相对路径）：
 *   'src/pages/{pageName}/index.jsx'                  → './styles/{PascalName}.module.less' 或 './styles/{PascalName}.less'
 *   'src/pages/{pageName}/modules/{PascalName}.jsx'    → '../styles/{PascalName}.<ext>'
 *   'src/pages/{pageName}/components/{PascalName}.jsx' → '../styles/{PascalName}.<ext>'
 */
export function buildStyleImportMap(
  results: StyleResult[],
  cssModules: boolean
): Map<string, string> {
  // 非 CSS Modules 模式：*.less 是全局 CSS，没有默认导出，不需要 import styles。
  // 返回空 map 让 file-assembler 走原始 className 字符串路径。
  if (!cssModules) return new Map()

  const map = new Map<string, string>()
  const ext = 'module.less'
  for (const ps of results) {
    for (const lf of ps.lessFiles) {
      const m = lf.path.match(/^src\/pages\/([^/]+)\/styles\/([^/]+?)(?:\.module)?\.less$/)
      if (!m) continue
      const pageName = m[1]
      const fileName = m[2]

      // 主页面 vs 抽取判定：fileName 是 pageName 的 PascalCase → 主页面
      if (fileName === toPascalCase(pageName)) {
        map.set(`src/pages/${pageName}/index.tsx`, `./styles/${fileName}.${ext}`)
      } else {
        map.set(
          `src/pages/${pageName}/modules/${fileName}.tsx`,
          `../styles/${fileName}.${ext}`
        )
        map.set(
          `src/pages/${pageName}/components/${fileName}.tsx`,
          `../styles/${fileName}.${ext}`
        )
      }
    }
  }
  return map
}

// ─── 被提升为文件顶部 const 的值（jsxLiteralConsts / enrichmentConsts / moduleTopConsts）
//     内部样式规则收集 ───
//
// 这些 const 值（renderFn body、resolveIcon 图标、enrichment 数组等）已被提升出主树，
// 主树里只剩 varRef 引用，故 #collectRules 走主树时拿不到它们的 className。
// 由 FileGenerator 在 state-builder / tree-finalizer 产物就绪后调用本函数补全。
//
// 与 #collectRules 一致：仅对有 id + 字符串 className 的 component/html 节点生成规则。

/** 从单个 BuildNode 收集规则（节点自身 + 子树），逻辑与 StyleConverter.#collectRules 对齐。 */
function collectRulesFromNode(node: any, out: LessRule[]): void {
  if (!node) return
  if (node.kind === 'component' || node.kind === 'html') {
    const id = node.id
    const cn = readPropClassName(node.props)
    // 同 #collectRules：const 值里的节点（icon / enrichment 项）也走统一 buildRule 路径
    if (id && cn) {
      const rule = buildRule(`.${id}`, safeConvertGrouped(cn), false)
      if (rule) out.push(rule)
    }
    // 递归 children
    const ch = node.children
    if (ch && ch.kind === 'loop') {
      for (const c of ch.template?.body ?? []) collectRulesFromNode(c, out)
    } else if (Array.isArray(ch)) {
      for (const c of ch) collectRulesFromNode(c, out)
    }
  } else if (node.kind === 'extract') {
    for (const c of node.body ?? []) collectRulesFromNode(c, out)
  }
}

/**
 * 从任意 const 值（数组 / 纯对象 / RenderFnValue / SlotNodeValue / BuildNode）递归收集样式规则。
 * 跳过 type-tagged 值类（binding/computed/varRef/rawExpr/literal）—— 它们不携带 className。
 */
export function collectRulesFromValue(value: any, out: LessRule[]): void {
  if (!value || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (const v of value) collectRulesFromValue(v, out)
    return
  }

  // BuildNode（component / html）
  if ((value.kind === 'component' || value.kind === 'html') && typeof value.tag === 'string') {
    collectRulesFromNode(value, out)
    // props 中可能内嵌 renderFn / slotNode / BuildNode（如表头 render fn）
    if (value.props) collectRulesFromValue(Object.values(value.props), out)
    return
  }

  // RenderFnValue → 进入 body
  if (value.type === 'renderFn') {
    const bodies = Array.isArray(value.body) ? value.body : [value.body]
    for (const b of bodies) collectRulesFromValue(b, out)
    return
  }

  // SlotNodeValue → 进入 node
  if (value.type === 'slotNode') {
    collectRulesFromValue(value.node, out)
    return
  }

  // 其余 type-tagged 值类（binding/computed/varRef/rawExpr/literal）无样式，跳过。
  // 纯对象（无 kind/type）→ 递归其值（如 tableColumns 的列对象、enrichment 数据项）
  collectRulesFromValue(Object.values(value), out)
}

/**
 * 把 const 值收集到的规则并入对应 lessFile，并重新生成内容。
 *
 * @param result   页面 StyleResult（被原地修改）
 * @param displayName less 文件展示名：主页面 = toPascalCase(pageName)；module/component = componentName
 * @param newRules 新收集到的规则
 */
export function appendConstRules(
  result: StyleResult,
  displayName: string,
  newRules: LessRule[]
): void {
  if (!newRules || newRules.length === 0) return

  const target = result.lessFiles.find(lf => {
    const m = lf.path.match(/\/styles\/([^/]+?)(?:\.module)?\.less$/)
    return m && m[1] === displayName
  })
  if (!target) return

  const isMain = displayName === toPascalCase(result.pageName)
  const bucket = isMain
    ? result.pageRules
    : (result.moduleRules[displayName] ??= [])

  // 去重：enrichment const 等按数据项展开，同一 icon 节点会为每个 item 各产一条
  // 同选择器规则（如 11 张图 → 11 条 .galCardHeartIcon）。按 selector 去重，保留首条。
  const existingSelectors = new Set(bucket.map(r => r.selector))
  for (const r of newRules) {
    if (!existingSelectors.has(r.selector)) {
      bucket.push(r)
      existingSelectors.add(r.selector)
    }
  }

  target.content = generateLessContent(bucket)
}
