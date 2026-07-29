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
// CLI 模式用（使用 tw-to-css 的本地实现）
// import { convertTailwindToCSS } from '../../../lib/convertTailwindToCSS'
// Electron 模式用（引用 Electron 主进程已有模块）
import { convertTailwindToCSS } from '../../../main/tailwind-to-css'
// ────────────────────────────────────────────────────────────

import type { BuildNode, ComponentNode, HtmlNode, LoopNode, RegularNode } from '../core/nodeTypes'
import type { PropValue } from '../core/valueTypes'
import type { PendingExtractedFile } from './treeFinalizer'
import { rewriteCssUrlPaths } from '../core/resourcePath'

/** ─── 手动开关 ─── */
/** 是否使用 CSS Modules（*.module.less）。可在调用方覆盖。 */
const USE_CSS_MODULES_DEFAULT = true

// ─── 产出物 ───

export interface StyleDeclaration {
  prop: string
  value: string
}

export interface LessRule {
  selector: string
  declarations: StyleDeclaration[]
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

      if (id && cn) {
        const { regular, hover } = splitClasses(cn)
        if (regular.length > 0) {
          const css = safeConvert(regular.join(' '))
          if (Object.keys(css).length > 0) {
            out.push({
              selector: `.${id}`,
              declarations: styleObjToDecls(css),
            })
          }
        }
        if (hover.length > 0) {
          const css = safeConvert(hover.join(' '))
          if (Object.keys(css).length > 0) {
            out.push({
              selector: `.${id}:hover`,
              declarations: styleObjToDecls(css),
            })
          }
        }
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

function splitClasses(cn: string): { regular: string[]; hover: string[] } {
  const regular: string[] = []
  const hover: string[] = []
  for (const c of cn.split(/\s+/).filter(Boolean)) {
    if (c.startsWith('hover:')) hover.push(c.slice('hover:'.length))
    else regular.push(c)
  }
  return { regular, hover }
}

function safeConvert(cn: string): Record<string, string> {
  try {
    // 调用前先改写 className 里的本地资源 url()（bg-[url(/uploads/...)] → /assets/...），
    // convertTailwindToCSS 是封装好的纯转换，不在此函数内塞资源路径逻辑。
    const rewritten = rewriteCssUrlPaths(cn)
    const r = convertTailwindToCSS(rewritten, true) as Record<string, string | number>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(r)) out[k] = String(v)
    return out
  } catch {
    return {}
  }
}

function styleObjToDecls(styleObj: Record<string, string>): StyleDeclaration[] {
  return Object.entries(styleObj).map(([k, v]) => ({
    prop: camelToKebab(k),
    value: v,
  }))
}

function camelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase()
}

export function generateLessContent(rules: LessRule[]): string {
  const lines: string[] = []
  lines.push('// Auto-generated by a2ui-transformer')
  lines.push('')
  for (const rule of rules) {
    lines.push(`${rule.selector} {`)
    for (const decl of rule.declarations) {
      lines.push(`  ${decl.prop}: ${decl.value};`)
    }
    lines.push('}')
    lines.push('')
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
    if (id && cn) {
      const { regular, hover } = splitClasses(cn)
      if (regular.length > 0) {
        const css = safeConvert(regular.join(' '))
        if (Object.keys(css).length > 0) {
          out.push({ selector: `.${id}`, declarations: styleObjToDecls(css) })
        }
      }
      if (hover.length > 0) {
        const css = safeConvert(hover.join(' '))
        if (Object.keys(css).length > 0) {
          out.push({ selector: `.${id}:hover`, declarations: styleObjToDecls(css) })
        }
      }
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
