/**
 * file-assembler — 把 FileDraft / PendingExtractedFile + FileUnit 拼成最终源代码
 *
 * 每个产物文件顶部按以下顺序生成 const 区域：
 *   1. 状态 destructure（来自 FileUnit.bindingRefs + computedRefs 的 accessPath）
 *      - 0 个：无 const
 *      - 1 个：const a = initialState.a
 *      - ≥2 个：const { a, b, c } = initialState
 *   2. jsxLiteralConsts（来自 containsJSX:true absolute computed）
 *   3. enrichmentConsts（来自循环 enrichment）
 *   4. propRoute 提升的 moduleTopConsts（来自 tree-finalizer）
 *   5. componentInternalConsts（useState 提升，来自 tree-finalizer + LiteralValue.useState lift）
 *
 * 三种文件模板：
 *   A. 主页面 index.jsx          —— `export default function XxxPage()`
 *   B. 模块文件 modules/{Name}.jsx —— `export default function {Name}()`
 *   C. 循环模板 components/{Name}Template.jsx —— named export，接收 `{data}` 参数
 *   D. state.js（由 state-builder 产物落盘）
 */

import type { GeneratedFile } from '../pipeline/pipelineContext'
import type { FileDraft, PendingExtractedFile, PendingConstDecl } from './treeFinalizer'
import type { StateBuilderResult, FileUnit } from './stateBuilder'
import { fileKeyOf } from '../core/fileKeys'
import { collectImports, renderImportBlock, injectImport, type ImportMap } from './importCollector'
import { emitNode, indent } from './jsxEmitter'
import { collectRelativeFields } from '../core/scopedEnrichment'
import { isFlatAccessPath } from '../core/accessPath'
import { emitKey, serializePlainJs } from './jsSerializer'
import type { EmitOptions } from './jsxEmitter'
import type { PropValue } from '../core/valueTypes'
import type { BuildNode, LoopNode, ComponentNode, TextNode, RegularNode } from '../core/nodeTypes'

// ─── 主入口 ───

export function assembleAllFiles(
  pageName: string,
  stateResult: StateBuilderResult,
  finalResult: { mainFile: FileDraft; extractedFiles: PendingExtractedFile[] },
  options: { styleImportMap?: Map<string, string>; emitId?: boolean } = {}
): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const { styleImportMap, emitId = true } = options

  // state.js
  files.push({
    path: `src/pages/${pageName}/state.ts`,
    content: stateResult.stateContent,
  })

  // 主页面 index.jsx
  files.push(assembleMainPage(pageName, finalResult.mainFile, stateResult, styleImportMap, emitId))

  // 抽取文件（modules/* 与 components/*）
  for (const ext of finalResult.extractedFiles) {
    files.push(assembleExtractedFile(pageName, ext, stateResult, styleImportMap, emitId))
  }

  return files
}

// ─── 文件顶部 const 区域生成 ───

/**
 * const 值序列化期间的样式上下文（模块级，同步单线程安全）。
 * serializeBuildNodeComponent / serializeReactElement / renderFn body 的 emitNode
 * 据此把 className 转为 `styles.${id}`（CSS Modules）。
 */
interface ConstEmitCtx {
  useCssModules: boolean
  cssModuleVarName: string
}
const CONST_EMIT_DEFAULT: ConstEmitCtx = { useCssModules: false, cssModuleVarName: 'styles' }
let constEmit: ConstEmitCtx = { ...CONST_EMIT_DEFAULT }

/** 在指定样式上下文内执行 fn，结束后恢复。 */
function withConstEmit<T>(copt: Partial<ConstEmitCtx>, fn: () => T): T {
  const prev = constEmit
  constEmit = { ...CONST_EMIT_DEFAULT, ...copt }
  try {
    return fn()
  } finally {
    constEmit = prev
  }
}

/**
 * 生成文件顶部的 const 区域
 * @param fileUnit state-builder 收集到的文件单元
 * @param treeModuleTopConsts tree-finalizer B4 propRoute 提升的 moduleTopConsts
 * @param treeComponentInternalConsts tree-finalizer 字面量双绑 lift 的 componentInternalConsts
 * @param useCssModules const 内 JSX 的 className 是否走 `styles.X`（CSS Modules）
 * @param cssModuleVarName CSS Modules 导入变量名，默认 'styles'
 */
function buildFileTopConsts(
  fileUnit: FileUnit | undefined,
  treeModuleTopConsts: PendingConstDecl[],
  treeComponentInternalConsts: PendingConstDecl[],
  useCssModules: boolean = false,
  cssModuleVarName: string = 'styles'
): { topBlock: string; componentBodyLines: string } {
  return withConstEmit({ useCssModules, cssModuleVarName }, () => {
    const lines: string[] = []
    const bodyLines: string[] = []

    // 1. 状态 destructure（仅平面路径，嵌套路径由 jsx-emitter 直接 emit initialState.xxx）
    if (fileUnit) {
      const flatPaths = new Set<string>()
      for (const b of fileUnit.bindingRefs) {
        if (isFlatAccessPath(b.accessPath)) flatPaths.add(b.accessPath)
      }
      for (const c of fileUnit.computedRefs) {
        if (isFlatAccessPath(c.accessPath)) flatPaths.add(c.accessPath)
      }

      if (flatPaths.size === 1) {
        const key = [...flatPaths][0]
        lines.push(`const ${key} = initialState.${key};`)
      } else if (flatPaths.size >= 2) {
        const keys = [...flatPaths].sort()
        lines.push(`const { ${keys.join(', ')} } = initialState;`)
      }
    }

    // 2. jsxLiteralConsts（containsJSX:true absolute computed 编译求值结果）
    if (fileUnit) {
      for (const jlc of fileUnit.jsxLiteralConsts) {
        lines.push(`const ${jlc.name} = ${serializeJsxValue(jlc.value)};`)
      }
    }

    // 3. enrichmentConsts（循环 enrichment 产物，可能含 JSX）
    if (fileUnit) {
      for (const ec of fileUnit.enrichmentConsts) {
        lines.push(`const ${ec.name} = ${serializeEnrichmentValue(ec.value)};`)
      }
    }

    // 4. propRoute moduleTopConsts
    for (const decl of treeModuleTopConsts) {
      lines.push(formatConstDecl(decl))
    }

    // 5. componentInternalConsts（useState 声明进函数体）
    for (const decl of treeComponentInternalConsts) {
      bodyLines.push(formatConstDecl(decl))
    }

    return {
      topBlock: lines.join('\n\n'),
      componentBodyLines: bodyLines.join('\n'),
    }
  })
}

// ─── 主页面 index.jsx ───

function assembleMainPage(
  pageName: string,
  draft: FileDraft,
  stateResult: StateBuilderResult,
  styleImportMap?: Map<string, string>,
  emitId: boolean = true
): GeneratedFile {
  const imports = collectImports(draft.rootTree).imports

  // .tsx 文件注入 React
  injectImport(imports, 'react', 'React', false)

  // 主页一定引入 `./state`
  injectImport(imports, `./state`, 'initialState', false)

  // 字面量双绑 lift 后会需要 useState
  if (draft.componentInternalConsts.some(c => c.isUseState)) {
    injectImport(imports, 'react', 'useState', true)
  }

  // CSS Modules
  const cssImportRel = styleImportMap?.get(draft.path)
  const useCssModules = !!cssImportRel
  if (cssImportRel) {
    injectImport(imports, cssImportRel, 'styles', false)
  }

  // 从 fileUnit 的 jsx-literal / enrichment const 中收集组件 import（如 resolveIcon 图标）
  const fUnitMain = stateResult.fileUnits.get(fileKeyOf.main())
  if (fUnitMain) {
    collectImportsFromConstValues(fUnitMain.jsxLiteralConsts.map(j => j.value), imports)
    for (const ec of fUnitMain.enrichmentConsts) {
      collectImportsFromConstValues(ec.value, imports)
    }
  }

  // 从 propRoute moduleTopConsts 中收集组件 import（如 columns render fn 内的 Tag、IconPlus 等）
  for (const mdc of draft.moduleTopConsts) {
    collectImportsFromConstValues([mdc.value], imports)
  }

  // 循环模板组件引用 → 注入 import
  for (const compName of collectLoopTemplateRefs(draft.rootTree)) {
    injectImport(imports, `../components/${compName}.tsx`, compName, true)
  }

  const importBlock = renderImportBlock(imports)

  // 文件顶部 consts
  const mainFileUnit = stateResult.fileUnits.get(fileKeyOf.main())
  const { topBlock, componentBodyLines } = buildFileTopConsts(
    mainFileUnit,
    draft.moduleTopConsts,
    draft.componentInternalConsts,
    useCssModules,
  )

  const rootJsx = emitNode(draft.rootTree, { useCssModules, emitId })

  // 函数体组装：数据/useState/模板之间空行
  const bodyLines: string[] = [
    `export default function ${draft.componentName}() {`,
  ]
  if (componentBodyLines) {
    bodyLines.push('')  // 组件行 → useState 空行
    bodyLines.push(indent(componentBodyLines, 2))
    bodyLines.push('')  // useState → return 空行
  }
  bodyLines.push('  return (')
  bodyLines.push(rootJsx ? indent(rootJsx, 4) : 'null')
  bodyLines.push('  )')
  bodyLines.push('}')
  const body = bodyLines.join('\n')

  const parts: string[] = []
  parts.push(headerComment(pageName))
  if (importBlock) parts.push(importBlock)
  if (topBlock) parts.push(topBlock)
  parts.push(body)

  return {
    path: draft.path,
    content: parts.join('\n\n') + '\n',
  }
}

// ─── 模块文件 modules/{Name}.jsx ───

function assembleExtractedFile(
  pageName: string,
  ext: PendingExtractedFile,
  stateResult: StateBuilderResult,
  styleImportMap?: Map<string, string>,
  emitId: boolean = true
): GeneratedFile {
  const isModule = ext.path.includes('/modules/')

  if (isModule) {
    return assembleModuleFile(pageName, ext, stateResult, styleImportMap, emitId)
  }
  return assembleComponentTemplate(pageName, ext, stateResult, styleImportMap, emitId)
}

function assembleModuleFile(
  pageName: string,
  ext: PendingExtractedFile,
  stateResult: StateBuilderResult,
  styleImportMap?: Map<string, string>,
  emitId: boolean = true
): GeneratedFile {
  const imports = collectImports(ext.body[0]).imports

  // .tsx 文件注入 React
  injectImport(imports, 'react', 'React', false)

  const cssImportRel = styleImportMap?.get(ext.path)
  const useCssModules = !!cssImportRel
  if (cssImportRel) {
    injectImport(imports, cssImportRel, 'styles', false)
  }

  if ((ext.componentInternalConsts ?? []).some(c => c.isUseState)) {
    injectImport(imports, 'react', 'useState', true)
  }

  // 从 fileUnit 的 jsx-literal / enrichment const 中收集组件 import
  const moduleFileKey = fileKeyOf.module(ext.componentName)
  const moduleFileUnit = stateResult.fileUnits.get(moduleFileKey)
  if (moduleFileUnit) {
    collectImportsFromConstValues(moduleFileUnit.jsxLiteralConsts.map(j => j.value), imports)
    for (const ec of moduleFileUnit.enrichmentConsts) {
      collectImportsFromConstValues(ec.value, imports)
    }
  }

  // 从 propRoute moduleTopConsts 中收集组件 import（如 columns render fn 内的 Tag、ProgressBar 等）
  for (const mdc of (ext.moduleTopConsts ?? [])) {
    collectImportsFromConstValues([mdc.value], imports)
  }

  // 文件顶部 consts
  const fileKey = fileKeyOf.module(ext.componentName)
  const fileUnit = stateResult.fileUnits.get(fileKey)
  const treeModuleTopConsts = ext.moduleTopConsts ?? []
  const needsInitialStateImport = fileUnit != null && (fileUnit.bindingRefs.length > 0 || fileUnit.computedRefs.length > 0)
  if (needsInitialStateImport) {
    injectImport(imports, `../state`, 'initialState', false)
  }

  for (const compName of collectLoopTemplateRefs(ext.body[0])) {
    injectImport(imports, `../components/${compName}.tsx`, compName, true)
  }

  const { topBlock, componentBodyLines } = buildFileTopConsts(
    fileUnit,
    treeModuleTopConsts,
    ext.componentInternalConsts ?? [],
    useCssModules,
  )

  const rootJsx = ext.body.length === 1
    ? emitNode(ext.body[0], { useCssModules, emitId })
    : emitFragment(ext.body, { useCssModules, emitId })

  const params = ext.params ?? {}
  const propsSnippet = Object.keys(params).length > 0 ? '(props)' : '()'

  const bodyLines = [
    `export default function ${ext.componentName}${propsSnippet} {`,
  ]
  if (componentBodyLines) {
    bodyLines.push('')  // 组件行 → useState 空行
    bodyLines.push(indent(componentBodyLines, 2))
    bodyLines.push('')  // useState → return 空行
  }
  bodyLines.push('  return (')
  bodyLines.push(rootJsx ? indent(rootJsx, 4) : 'null')
  bodyLines.push('  )')
  bodyLines.push('}')
  const body = bodyLines.join('\n')

  const importBlock = renderImportBlock(imports)
  const finalParts: string[] = []
  if (importBlock) finalParts.push(importBlock)
  if (topBlock) finalParts.push(topBlock)
  if (body) finalParts.push(body)

  return {
    path: ext.path,
    content: finalParts.join('\n\n') + '\n',
  }
}

// ─── 循环模板 components/{Name}Template.jsx ───

function assembleComponentTemplate(
  pageName: string,
  ext: PendingExtractedFile,
  stateResult: StateBuilderResult,
  styleImportMap?: Map<string, string>,
  emitId: boolean = true
): GeneratedFile {
  const root = ext.body[0]

  // 走一遍 body，收集所有相对 binding 的顶级字段（destructure 用）
  const fields = collectRelativeFields(root)
  // 补充：tree-finalizer 已将 ComputedValue.useState 替换为 VarRefValue，
  // collectRelativeFields 无法从 VarRef 反推原始 relative field。
  // 从 componentInternalConsts 中找出初始值为简单 varRef 的 useState 声明（即相对路径引用）。
  for (const c of (ext.componentInternalConsts ?? [])) {
    if (c.isUseState && c.value && typeof c.value === 'object' && (c.value as any).type === 'varRef') {
      const refName = (c.value as any).name
      if (refName && !refName.startsWith('initialState.')) {
        fields.add(refName)
      }
    }
  }
  // 排除已被文件顶部 const 占用的名字：内层循环若被富集（relative + containsJSX），
  // 其富集 const 名 = 循环 data 的 accessPath（如 tags），会与 destructure 字段撞名。
  // 这种情况下该名字是顶部 const（const tags = [...]），不能再进 data destructure。
  const fileUnitForExcl = stateResult.fileUnits.get(fileKeyOf.loopTemplate(ext.componentName))
  if (fileUnitForExcl) {
    for (const ec of fileUnitForExcl.enrichmentConsts) fields.delete(ec.name)
    for (const jlc of fileUnitForExcl.jsxLiteralConsts) fields.delete(jlc.name)
  }
  for (const dc of (ext.moduleTopConsts ?? [])) fields.delete(dc.name)
  const destructureLine = fields.size > 0
    ? `  const { ${[...fields].sort().join(', ')} } = data;`
    : ''

  const cssImportRel = styleImportMap?.get(ext.path)
  const useCssModules = !!cssImportRel

  const rootJsx = root
    ? emitNode(root, { inTemplate: true, useCssModules, emitId })
    : 'null'

  const imports = root ? collectImports(root).imports : new Map<string, any>()

  // .tsx 文件注入 React
  injectImport(imports, 'react', 'React', false)

  if (cssImportRel) {
    injectImport(imports, cssImportRel, 'styles', false)
  }

  // 从 fileUnit 的 jsx-literal / enrichment const 中收集组件 import
  const templateFileKey = fileKeyOf.loopTemplate(ext.componentName)
  const templateFileUnit = stateResult.fileUnits.get(templateFileKey)
  if (templateFileUnit) {
    collectImportsFromConstValues(templateFileUnit.jsxLiteralConsts.map(j => j.value), imports)
    for (const ec of templateFileUnit.enrichmentConsts) {
      collectImportsFromConstValues(ec.value, imports)
    }
  }

  // 文件顶部 consts（模板文件可能也含有 absolute binding → 收集 stateRefs）
  const fileKey = fileKeyOf.loopTemplate(ext.componentName)
  const fileUnit = stateResult.fileUnits.get(fileKey)
  const treeModuleTopConsts = ext.moduleTopConsts ?? []
  if (fileUnit != null && (fileUnit.bindingRefs.length > 0 || fileUnit.computedRefs.length > 0)) {
    injectImport(imports, `../../state`, 'initialState', false)
  }

  // 嵌套循环：内层循环模板（兄弟 components/ 文件）由本模板文件渲染 → 注入其 import
  // （路径：模板在 components/，兄弟模板用 './'；主页面/模块用 '../components/' 由各自 assemble 处理）
  if (root) {
    for (const compName of collectLoopTemplateRefs(root)) {
      injectImport(imports, `./${compName}.tsx`, compName, true)
    }
  }
  const { topBlock, componentBodyLines } = buildFileTopConsts(
    fileUnit,
    treeModuleTopConsts,
    ext.componentInternalConsts ?? [],
    useCssModules,
  )

  // 如果模板文件有 useState 声明，注入 import { useState } from 'react'
  if ((ext.componentInternalConsts ?? []).some(c => c.isUseState)) {
    injectImport(imports, 'react', 'useState', true)
  }

  const importBlock = renderImportBlock(imports)

  const bodyLines: string[] = [
    `export const ${ext.componentName} = ({ data }) => {`,
  ]
  // destructure（模板 props 解构）
  if (destructureLine) {
    bodyLines.push(destructureLine)
  }
  // useState（组件内部状态）
  if (componentBodyLines) {
    bodyLines.push('')  // 组件行/数据 → useState 空行
    bodyLines.push(indent(componentBodyLines, 2))
  }
  // return（模板）
  if (destructureLine || componentBodyLines) bodyLines.push('')
  bodyLines.push('  return (')
  bodyLines.push(rootJsx ? indent(rootJsx, 4) : 'null')
  bodyLines.push('  )')
  bodyLines.push('}')
  const body = bodyLines.join('\n')

  const parts: string[] = []
  if (importBlock) parts.push(importBlock)
  if (body) parts.push(body)

  return {
    path: ext.path,
    content: parts.join('\n\n') + '\n',
  }
}

// ─── 收集循环模板引用 ───

function collectLoopTemplateRefs(node: BuildNode | null | undefined): Set<string> {
  const refs = new Set<string>()
  if (!node) return refs
  collectLoopRefs(node, refs)
  return refs
}

function collectLoopRefs(node: BuildNode, refs: Set<string>): void {
  if (!node) return
  if (node.kind === 'component' || node.kind === 'html') {
    const ch = node.children
    if (ch && (ch as any).kind === 'loop') {
      // 只收当前文件直接渲染的循环模板；内层循环（在 template body 里）由外层模板文件
      // 自己 assembleComponentTemplate 时收集，否则内层模板 import 会被错写到上层文件。
      const cn = (ch as any).template?.componentName
      if (cn) refs.add(cn)
      return
    }
    if (Array.isArray(ch)) {
      for (const c of ch) {
        if (c && typeof c === 'object' && 'kind' in c) {
          collectLoopRefs(c as BuildNode, refs)
        }
      }
      return
    }
  } else if (node.kind === 'extract') {
    for (const c of node.body) collectLoopRefs(c, refs)
  }
}

// ─── Fragment（多根 body 时回退） ───

function emitFragment(body: BuildNode[], opts?: EmitOptions): string {
  const inner = body.map(c => emitNode(c, opts)).filter(Boolean).join('\n')
  return `<>\n${indent(inner, 2)}\n</>`
}

// ─── const 声明序列化 ───

function formatConstDecl(decl: { name: string; value: PropValue; isUseState?: boolean }): string {
  const valueStr = serializeForConstValue(decl.value)
  if (decl.isUseState) {
    const setter = 'set' + decl.name.charAt(0).toUpperCase() + decl.name.slice(1)
    return `const [${decl.name}, ${setter}] = useState(${valueStr});`
  }
  return `const ${decl.name} = ${valueStr};`
}

function formatConstValue(value: PropValue): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const v = value as any
  if (v.type === 'varRef') return v.name
  if (v.type === 'rawExpr') return v.value
  // LiteralValue → 取内部 value
  if (v.type === 'literal') return formatConstValue(v.value)
  if (Array.isArray(value) || (typeof value === 'object' && v.type === undefined)) {
    // 检查 circular reference（列定义 render fn body 可能含复杂嵌套）
    try {
      return JSON.stringify(value, null, 2)
    } catch (e: any) {
      console.warn(`  [debug] formatConstValue circular (${e.message}): ${typeof value}`)
      // fallback: 尝试找出问题路径
      const seen = new WeakSet()
      const findCycle = (obj: any, path: string): string | null => {
        if (obj && typeof obj === 'object') {
          if (seen.has(obj)) return path
          seen.add(obj)
          for (const [k, v] of Object.entries(obj)) {
            const res = findCycle(v, `${path}.${k}`)
            if (res) return res
          }
        }
        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            const res = findCycle(obj[i], `${path}[${i}]`)
            if (res) return res
          }
        }
        return null
      }
      const cyclePath = findCycle(value, '')
      console.warn(`  [debug] circular at: ${cyclePath}`)
      return 'null'
    }
  }
  return JSON.stringify(value)
}

// ─── JSX-literal 值序列化（含 JSX 时） ───

function serializeJsxValue(value: unknown): string {
  return serializeForConstValue(value)
}

function serializeEnrichmentValue(value: unknown[]): string {
  if (value.length === 0) return '[]'
  const childIndent = 2
  const pad = ' '.repeat(childIndent)
  const items = value.map(v => pad + serializeForConstValue(v, childIndent))
  return '[\n' + items.join(',\n') + '\n]'
}

function serializeForConstValue(value: unknown, lvl: number = 0, compact: boolean = false): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (typeof value === 'function') {
    console.warn('  [warn] containsJSX: const 含函数，无法 emit 源代码，回退 null')
    return 'null'
  }

  const childIndent = lvl + 2
  const pad = ' '.repeat(childIndent)
  const closePad = ' '.repeat(lvl)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    // compact 模式（JSX 标签内 prop 值）→ 单行
    if (compact) {
      return '[' + value.map(v => serializeForConstValue(v, lvl, true)).join(', ') + ']'
    }
    const items = value.map(v => pad + serializeForConstValue(v, childIndent))
    return '[\n' + items.join(',\n') + '\n' + closePad + ']'
  }

  if (typeof value === 'object') {
    const v = value as any
    if (v.type === 'varRef') return v.name
    if (v.type === 'rawExpr') return v.value
    if (typeof v.type === 'string' && typeof v.props === 'object' && v.props !== null) {
      return serializeReactElement(v)
    }
    // RenderFnValue → 内联渲染函数（按当前 lvl 缩进传递）
    if (v.type === 'renderFn') {
      const paramsArr: Array<{ name: string; dataSource?: any; dataField?: string }> = v.params ?? []
      const sig = paramsArr.map((p: any) => p.name).join(', ')
      const dataSourceParam = paramsArr.find((p: any) => p.dataSource)
      const dataSourceName: string = dataSourceParam?.name ?? ''
      const dataField: string | undefined = dataSourceParam?.dataField
      // 解构源：dataField 时为 name.dataField（如 row.rawData），否则 name
      const dataAccessor: string = dataField ? `${dataSourceName}.${dataField}` : dataSourceName
      const bodies = Array.isArray(v.body) ? v.body : [v.body]
      const bodyOpts = {
        inRenderFnBody: !!dataSourceName,
        renderFnDataVarName: dataAccessor,
        useCssModules: constEmit.useCssModules,
        cssModuleVarName: constEmit.cssModuleVarName,
      }
      // 函数体缩进：比当前 lvl 多 2 空格
      const bodyPad = ' '.repeat(lvl + 2)
      const closePad = ' '.repeat(lvl)
      // destructure（源 = dataAccessor，如 row.rawData）
      let destructureLine = ''
      if (dataSourceName) {
        const fields = new Set<string>()
        for (const b of bodies) {
          const f = collectRelativeFields(b as any)
          for (const field of f) fields.add(field)
        }
        if (fields.size > 0) {
          destructureLine = `${bodyPad}const { ${[...fields].sort().join(', ')} } = ${dataAccessor};\n`
        }
      }
      const bodyJSX = bodies.map((n: any) => emitNode(n, bodyOpts as any)).join('\n')
      if (destructureLine) {
        return `(${sig}) => {\n${destructureLine}${bodyPad}return (\n${indent(bodyJSX, lvl + 4)}\n${bodyPad})\n${closePad}}`
      }
      return `(${sig}) => (\n${indent(bodyJSX, lvl + 2)}\n${closePad})`
    }
    // BuildNode（kind: 'component'，来自 resolveIcon 的图标节点等）→ JSX 元素
    if (v.kind === 'component' && typeof v.tag === 'string' && typeof v.props === 'object') {
      return serializeBuildNodeComponent(v)
    }
    // 纯对象 → 美化多行序列化（智能 key 引号 + 缩进）
    const isPropValueType = ['binding', 'computed', 'literal', 'varRef', 'rawExpr', 'renderFn', 'slotNode'].includes(v.type)
    if (!isPropValueType && !Array.isArray(value) && typeof value === 'object' && v.kind === undefined) {
      const keys = Object.keys(value).filter(k => !k.startsWith('__'))
      if (keys.length === 0) return '{}'
      // compact 模式 → 单行
      if (compact) {
        const entries = keys.map(k => `${emitKey(k)}: ${serializeForConstValue((value as any)[k], lvl, true)}`)
        return '{ ' + entries.join(', ') + ' }'
      }
      const entries = keys.map(k => `${pad}${emitKey(k)}: ${serializeForConstValue((value as any)[k], childIndent)}`)
      return '{\n' + entries.join(',\n') + '\n' + closePad + '}'
    }
    // 兜底：未知类型 → JSON
    try {
      return serializePlainJs(value, lvl)
    } catch {
      console.warn('  [warn] containsJSX: value 含循环引用，回退 null')
      return 'null'
    }
  }

  return 'null'
}

function serializeReactElement(v: { type: string; props: any }): string {
  const tagName = v.type
  const props = v.props ?? {}
  const propParts: string[] = []
  let childrenPart: string | null = null

  for (const [k, vv] of Object.entries(props)) {
    if (k === 'children') {
      childrenPart = serializeForConstValue(vv)
      continue
    }
    if (k === 'key') continue
    // className：CSS Modules 模式 → styles.${id}（id 由外部节点提供，存于 v.id）
    if ((k === 'className' || k === 'class') && constEmit.useCssModules && (v as any).id && typeof vv === 'string') {
      propParts.push(`className={${constEmit.cssModuleVarName}.${(v as any).id}}`)
      continue
    }
    if (vv === true) propParts.push(k)
    else if (vv === false || vv === null || vv === undefined) continue
    else if (typeof vv === 'string') propParts.push(`${k}=${JSON.stringify(vv)}`)
    else if (typeof vv === 'number' || typeof vv === 'boolean') propParts.push(`${k}={${vv}}`)
    else propParts.push(`${k}={${serializeForConstValue(vv, 0, true)}}`)
  }

  const propsStr = propParts.join(' ')
  if (childrenPart && childrenPart !== 'null') {
    return `<${tagName}${propsStr ? ' ' + propsStr : ''}>${childrenPart}</${tagName}>`
  }
  return `<${tagName}${propsStr ? ' ' + propsStr : ''} />`
}

/** 检测值中是否嵌套有 BuildNode（kind:'component'） */
function hasBuildNode(value: any): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasBuildNode)
  const v = value as any
  if ((v.kind === 'component' || v.kind === 'html') && typeof v.tag === 'string') return true
  const result = Object.values(value).some((item: any) => hasBuildNode(item))
  // For data items enriched with icons, this should find the BuildNode
  return result
}

/** 序列化一个 BuildNode（kind:'component'）到 JSX 自闭合标签 */
function serializeBuildNodeComponent(v: { tag: string; props: Record<string, any>; selfClosing?: boolean; id?: string }): string {
  const tagName = v.tag
  const props = v.props ?? {}
  const propParts: string[] = []

  for (const [k, vv] of Object.entries(props)) {
    // className：CSS Modules 模式 → styles.${id}（id 由 resolveIcon 透传的原始元素 id 提供）
    if ((k === 'className' || k === 'class') && constEmit.useCssModules && v.id && typeof vv === 'string') {
      propParts.push(`className={${constEmit.cssModuleVarName}.${v.id}}`)
      continue
    }
    if (vv === true) propParts.push(k)
    else if (vv === false || vv === null || vv === undefined) continue
    else if (typeof vv === 'string') propParts.push(`${k}=${JSON.stringify(vv)}`)
    else if (typeof vv === 'number' || typeof vv === 'boolean') propParts.push(`${k}={${vv}}`)
    else if (typeof vv === 'object') {
      // 嵌套对象/数组 → 序列化为表达式
      if (Array.isArray(vv) || !(vv as any).type) {
        propParts.push(`${k}={${serializeForConstValue(vv, 0, true)}}`)
      } else {
        propParts.push(`${k}={${serializeForConstValue(vv, 0, true)}}`)
      }
    }
  }

  const propsStr = propParts.join(' ')
  return `<${tagName}${propsStr ? ' ' + propsStr : ''} />`
}

/**
 * 收集 jsx-literal / enrichment const 值中的组件 import（如 resolveIcon 产生的 BuildNode 图标）
 */
function collectImportsFromConsts(
  consts: Array<{ value: PropValue }>,
  imports: Map<string, any>
): void {
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    // BuildNode 组件 → 收集 import
    if (v.kind === 'component' && v.import) {
      const spec = v.import
      if (typeof spec === 'string') {
        injectImport(imports, spec, v.tag ?? '', false)
      } else if (typeof spec === 'object' && spec.source) {
        injectImport(imports, spec.source, v.tag ?? '', !!spec.named)
      }
    }
    // 递归 props
    if (v.props && typeof v.props === 'object') walk(Object.values(v.props))
    // 递归普通对象键
    for (const item of Object.values(v)) walk(item)
  }
  for (const c of consts) walk(c.value)
}

/**
 * 收集 jsx-literal / enrichment const 值中的组件 import（如 resolveIcon 产生的 BuildNode 图标）
 * 直接修改传入的 imports Map。
 */
function collectImportsFromConstValues(values: any[], imports: Map<string, any>): void {
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    // BuildNode 组件 → 收集 import
    if (v.kind === 'component' && v.import) {
      const spec = v.import
      if (typeof spec === 'string') {
        injectImport(imports, spec, v.tag ?? '', false)
      } else if (typeof spec === 'object' && spec.source) {
        injectImport(imports, spec.source, v.tag ?? '', !!spec.named)
      }
    }
    // 递归 props
    if (v.props && typeof v.props === 'object') walk(Object.values(v.props))
    // 递归普通对象键
    for (const item of Object.values(v)) walk(item)
  }
  for (const val of values) walk(val)
}

function headerComment(pageName: string): string {
  return `/**\n * ${pageName} 页面（自动生成，请勿手动修改）\n */`
}
