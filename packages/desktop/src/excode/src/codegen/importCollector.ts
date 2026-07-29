/**
 * import-collector — 按文件维度收集 import
 *
 * 复用旧 ImportCollector 的 ImportMap 形态：source → { default, named }。
 * 遍历 BuildNode 树（包括 children、props、wrapper），
 * 对每个有 import 的 ComponentNode 建索引；同源合并（默认+命名允许同一行）。
 *
 * props 扫描说明：
 *   resolveIcon 等产生的 BuildNode（kind:'component',带 import）会嵌入到
 *   父组件的 prop 值中（如 Button.leftIcon、Input.prefix），而非放在 children
 *   下。walkPropsForImports 负责递归扫描 prop 值，收集这些内嵌节点的 import。
 */

import type { BuildNode, ComponentNode, HtmlNode, ExtractNode, LoopNode, RegularNode } from '../core/nodeTypes'
import type { ImportSpec, PropValue } from '../core/valueTypes'
import { getIconPackage } from '../core/iconCollection'

interface ImportEntry {
  default: string | null
  named: Set<string>
}

export type ImportMap = Map<string, ImportEntry>

export interface CollectedImports {
  imports: ImportMap
  warnings: string[]
}

export function collectImports(
  root: BuildNode | null | undefined
): CollectedImports {
  const imports: ImportMap = new Map()
  const warnings: string[] = []

  walkForImports(root, imports, warnings)

  return { imports, warnings }
}

// ─── 内部辅助 ───

function addImport(map: ImportMap, source: string, named: boolean, tag: string): void {
  if (!source || !tag) return
  if (!map.has(source)) {
    map.set(source, { default: null, named: new Set() })
  }
  const entry = map.get(source)!
  if (named) {
    entry.named.add(tag)
  } else if (!entry.default) {
    entry.default = tag
  }
}

function walkForImports(
  node: BuildNode | null | undefined,
  imports: ImportMap,
  warnings: string[]
): void {
  if (!node) return

  switch (node.kind) {
    case 'component':
      collectNodeImport(node as ComponentNode, imports, warnings)
      walkPropsForImports((node as ComponentNode).props, imports, warnings)
      walkChildren((node as ComponentNode).children, imports, warnings)
      if ((node as ComponentNode).wrapper) {
        walkForImports((node as ComponentNode).wrapper, imports, warnings)
      }
      break
    case 'html':
      walkChildren((node as HtmlNode).children, imports, warnings)
      // html 节点也可能挂 wrapper（如 Carousel 给 div 子节点包 CarouselItem），
      // jsxEmitter.emitHtml 会渲染它，这里必须同步收集其 import，否则漏引用。
      if ((node as HtmlNode).wrapper) {
        walkForImports((node as HtmlNode).wrapper, imports, warnings)
      }
      break
    case 'extract':
      // ExtractNode 通常已被 tree-finalizer 替换；若还有遗留，遍历 body
      for (const c of (node as ExtractNode).body) walkForImports(c, imports, warnings)
      break
    case 'text':
    default:
      break
  }
}

function collectNodeImport(
  node: ComponentNode,
  imports: ImportMap,
  warnings: string[]
): void {
  const tag = node.tag ?? node.component
  if (!node.import) return

  const spec: ImportSpec = node.import
  if (typeof spec === 'string') {
    addImport(imports, spec, false, tag)
  } else if (spec && typeof spec === 'object' && typeof spec.source === 'string') {
    addImport(imports, spec.source, !!spec.named, tag)
  } else {
    warnings.push(`unknown import spec: ${JSON.stringify(spec)} for tag "${tag}"`)
  }
}

function walkChildren(
  children: RegularNode[] | LoopNode | null | undefined,
  imports: ImportMap,
  warnings: string[]
): void {
  if (!children) return
  if ((children as any).kind === 'loop') {
    // Loop template body 的 import 归属模板自身文件单元，不在当前文件收集
    return
  }
  if (Array.isArray(children)) {
    for (const c of children) {
      walkForImports(c, imports, warnings)
    }
  }
}

/**
 * 遍历组件 props，收集嵌入的 BuildNode（如 resolveIcon 产生的图标节点）的 import。
 * 图标节点直接作为 prop 值嵌入（例如 Button.leftIcon / Input.prefix），
 * 而非放在 children 中，因此需要额外扫描 props。
 */
function walkPropsForImports(
  props: Record<string, PropValue> | undefined,
  imports: ImportMap,
  warnings: string[]
): void {
  if (!props) return
  for (const value of Object.values(props)) {
    walkValueForImports(value, imports, warnings)
  }
}

/**
 * 递归扫描一个值及其嵌套，收集所有 BuildNode（kind:'component'）的 import。
 */
function walkValueForImports(
  value: any,
  imports: ImportMap,
  warnings: string[]
): void {
  if (!value || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (const item of value) {
      walkValueForImports(item, imports, warnings)
    }
    return
  }

  // BuildNode 组件：收集 import 并递归其 props
  if (value.kind === 'component' && value.import) {
    collectNodeImport(value, imports, warnings)
    walkPropsForImports(value.props, imports, warnings)
    // 递归 children（图标节点一般 selfClosing，但泛化处理）
    if (value.children) {
      if (Array.isArray(value.children)) {
        for (const c of value.children) walkValueForImports(c, imports, warnings)
      } else {
        walkValueForImports(value.children, imports, warnings)
      }
    }
  }
  // BuildNode 组件（无 import 但有 tag，如 html 节点 / resolveIcon 产物）
  if (value.kind === 'component' || value.kind === 'html') {
    walkPropsForImports(value.props, imports, warnings)
    if (value.children) {
      if (Array.isArray(value.children)) {
        for (const c of value.children) walkValueForImports(c, imports, warnings)
      } else {
        walkValueForImports(value.children, imports, warnings)
      }
    }
  }

  // RenderFnValue：body 中的 BuildNode（如 Table 列 render 内的 IconButton）import 收集
  if (value.type === 'renderFn') {
    const bodies = Array.isArray(value.body) ? value.body : [value.body]
    for (const b of bodies) walkValueForImports(b, imports, warnings)
  }

  // SlotNodeValue：node 中的 BuildNode import 收集
  if (value.type === 'slotNode' && value.node) {
    walkValueForImports(value.node, imports, warnings)
  }

  // 递归检查普通对象的每个值（可能嵌套在数据对象中）
  for (const v of Object.values(value)) {
    walkValueForImports(v, imports, warnings)
  }
}

// ─── 渲染 import 块 ───

export function renderImportBlock(imports: ImportMap): string {
  const sources = [...imports.keys()].sort(importSortKey)
  const lines: string[] = []

  for (const source of sources) {
    const entry = imports.get(source)!
    const defaultPart = entry.default ?? ''
    const named = entry.named && entry.named.size > 0
      ? `{ ${[...entry.named].sort().join(', ')} }`
      : ''

    if (defaultPart && named) {
      lines.push(`import ${defaultPart}, ${named} from '${source}';`)
    } else if (named) {
      lines.push(`import ${named} from '${source}';`)
    } else if (defaultPart) {
      lines.push(`import ${defaultPart} from '${source}';`)
    }
  }

  return lines.join('\n')
}

/**
 * import 排序优先级：
 *   0. react 相关
 *   1. 当前目标库的图标库（@nce/icon-plus / @hui/icon-plus，经 getIconPackage() 取）
 *   2. ./modules/*（页面模块）
 *   3. ../components/*（循环模板）
 *   4. 目标组件库（其余外部包，如 @nce/eview-react/* / @cloudsop/eview-ui/*）
 *   5. ./state（页面数据源）
 *   6. ./styles/*（样式）
 *   7. 其他
 *
 * 桶 1/4 不硬编码任何具体包名：图标库取当前激活值，目标组件库兜底"外部包"，
 * 覆盖任意目标库/图标库包名。renderImportBlock 在 FileGenerator（step 4）执行，
 * 晚于 registerComponents（step 0）的 setIconPackage，读到的 iconPkg 已是当前库值。
 */
function importSortKey(a: string, b: string): number {
  const priority = (s: string): number => {
    if (s === 'react' || s === 'react-dom') return 0
    if (s === getIconPackage()) return 1
    if (s.includes('/modules/') || s.startsWith('./modules/')) return 2
    if (s.includes('/components/') || s.startsWith('../components/')) return 3
    if (s === './state') return 5
    if (s.startsWith('./styles/')) return 6
    if (!s.startsWith('.')) return 4   // 其余外部包 = 目标组件库（react/icon 已在前面返回）
    return 7
  }
  const pa = priority(a)
  const pb = priority(b)
  if (pa !== pb) return pa - pb
  return a.localeCompare(b)
}

/**
 * 强制注入一个 import（如 always-react-useState）。
 */
export function injectImport(
  imports: ImportMap,
  source: string,
  specifier: string,
  named: boolean
): void {
  addImport(imports, source, named, specifier)
}
