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

import type { GeneratedFile } from '../pipeline/pipeline-context'
import type { FileDraft, PendingExtractedFile, PendingConstDecl } from './tree-finalizer'
import type { StateBuilderResult, FileUnit } from './state-builder'
import { fileKeyOf } from '../core/file-keys'
import { collectImports, renderImportBlock, injectImport, type ImportMap } from './import-collector'
import { emitNode, indent, bindingRef, serializeRenderFnBody } from './jsx-emitter'
import { collectRelativeFields } from '../core/scoped-enrichment'
import { isFlatAccessPath, isValidIdentifier, cssModuleRef } from '../core/access-path'
import { emitKey, serializePlainJs } from './js-serializer'
import type { EmitOptions } from './jsx-emitter'
import type { PropValue } from '../core/value-types'
import type { BuildNode, LoopNode, ComponentNode, TextNode, RegularNode } from '../core/node-types'

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

  // shared-state.ts（仅当存在共享 key：事件 Action 改写的 path）
  if (stateResult.sharedStateContent) {
    files.push({
      path: `src/pages/${pageName}/shared-state.ts`,
      content: stateResult.sharedStateContent,
    })
  }

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
 * serializeComponentConst / renderFn body 的 emitNode
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
  const collected = collectImports(draft.rootTree)
  const imports = collected.imports
  const hasAction = collected.hasAction

  // .tsx 文件注入 React
  injectImport(imports, 'react', 'React', false)

  // 主页引用 state 时才引入 `./state`（main unit 有 bindingRefs/computedRefs →
  // destructure 或内联 initialState.xxx；无引用则不 import，避免死 import）
  const fUnitForStateCheck = stateResult.fileUnits.get(fileKeyOf.main())
  const usesState = !!(fUnitForStateCheck && (fUnitForStateCheck.bindingRefs.length > 0 || fUnitForStateCheck.computedRefs.length > 0))
  if (usesState) {
    injectImport(imports, `./state`, 'initialState', false)
  }

  // 字面量双绑 lift 后会需要 useState
  if (draft.componentInternalConsts.some(c => c.isUseState && !c.shared)) {
    injectImport(imports, 'react', 'useState', true)
  }

  // 共享响应式 state：该文件含 shared const（读 useSharedState）或 ActionValue（写 setSharedState）
  if (draft.componentInternalConsts.some(c => c.shared)) {
    injectImport(imports, `./shared-state`, 'useSharedState', true)
  }
  if (hasAction) {
    injectImport(imports, `./shared-state`, 'setSharedState', true)
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
  // 路径：主页面 index.tsx 在 pages/{pageName}/ 根，components/ 同级 → './components/'
  //（modules/Xxx.tsx 引用才是 '../components/'，见 assembleExtractModule）
  for (const compName of collectLoopTemplateRefs(draft.rootTree)) {
    injectImport(imports, `./components/${compName}.tsx`, compName, true)
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

  // inline loop 解构排除集：enrichment/const 名（避免与 item 字段撞名）
  const inlineLoopExcludedFields = new Set<string>()
  if (fUnitMain) {
    for (const ec of fUnitMain.enrichmentConsts) inlineLoopExcludedFields.add(ec.name)
    for (const jlc of fUnitMain.jsxLiteralConsts) inlineLoopExcludedFields.add(jlc.name)
  }
  for (const dc of (draft.moduleTopConsts ?? [])) inlineLoopExcludedFields.add(dc.name)

  const rootJsx = emitNode(draft.rootTree, { useCssModules, emitId, inlineLoopExcludedFields })

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
  // ⚠️ 暂不考虑多根 extract：当前 A2UI 输入数据 extract.body 必为单根（length===1），
  // 故本函数多处只取 body[0]（collectImports / collectLoopTemplateRefs / rootJsx）。
  // 下面的 emitFragment 多根分支保留但暂不触发；若未来输入出现多根，import/ref 收集也需全量迭代 body。
  const collectedModule = collectImports(ext.body[0])
  const imports = collectedModule.imports
  const hasAction = collectedModule.hasAction

  // .tsx 文件注入 React
  injectImport(imports, 'react', 'React', false)

  const cssImportRel = styleImportMap?.get(ext.path)
  const useCssModules = !!cssImportRel
  if (cssImportRel) {
    injectImport(imports, cssImportRel, 'styles', false)
  }

  if ((ext.componentInternalConsts ?? []).some(c => c.isUseState && !c.shared)) {
    injectImport(imports, 'react', 'useState', true)
  }

  // 共享响应式 state（模块路径相对 '../shared-state'，与 '../state' 同级）
  if ((ext.componentInternalConsts ?? []).some(c => c.shared)) {
    injectImport(imports, `../shared-state`, 'useSharedState', true)
  }
  if (hasAction) {
    injectImport(imports, `../shared-state`, 'setSharedState', true)
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

  // inline loop 解构排除集（同 assembleMainPage）
  const inlineLoopExcludedFields = new Set<string>()
  if (moduleFileUnit) {
    for (const ec of moduleFileUnit.enrichmentConsts) inlineLoopExcludedFields.add(ec.name)
    for (const jlc of moduleFileUnit.jsxLiteralConsts) inlineLoopExcludedFields.add(jlc.name)
  }
  for (const dc of (ext.moduleTopConsts ?? [])) inlineLoopExcludedFields.add(dc.name)

  const rootJsx = ext.body.length === 1
    ? emitNode(ext.body[0], { useCssModules, emitId, inlineLoopExcludedFields })
    : emitFragment(ext.body, { useCssModules, emitId, inlineLoopExcludedFields })

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
  // 暂不考虑多根 extract（输入必单根）；只取 body[0]
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
  // 仅 destructure 合法标识符 top 字段；非标识符字段（如 a-b）不进 destructure，
  // 由 jsx-emitter bindingRef 用 base 访问（data["a-b"]）
  const destructureFields = [...fields].filter(isValidIdentifier).sort()
  const destructureLine = destructureFields.length > 0
    ? `  const { ${destructureFields.join(', ')} } = data;`
    : ''

  const cssImportRel = styleImportMap?.get(ext.path)
  const useCssModules = !!cssImportRel

  const rootJsx = root
    ? emitNode(root, { inTemplate: true, useCssModules, emitId })
    : 'null'

  const collectedTpl = root ? collectImports(root) : null
  const imports = collectedTpl ? collectedTpl.imports : new Map<string, any>()
  const hasAction = collectedTpl?.hasAction ?? false

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

  // 共享响应式 state（模板路径相对 '../../shared-state'，与 '../../state' 同级）
  if ((ext.componentInternalConsts ?? []).some(c => c.shared)) {
    injectImport(imports, `../../shared-state`, 'useSharedState', true)
  }
  if (hasAction) {
    injectImport(imports, `../../shared-state`, 'setSharedState', true)
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
  if ((ext.componentInternalConsts ?? []).some(c => c.isUseState && !c.shared)) {
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
      if (!(ch as any).inline) {
        // 非 inline：模板在单独文件，记录引用，不递归（嵌套循环由 assembleComponentTemplate 处理）
        const cn = (ch as any).template?.componentName
        if (cn) refs.add(cn)
      } else {
        // inline：模板 body 在当前文件，递归找嵌套循环（嵌套的非 inline 循环需要注入 import）
        for (const c of (ch as any).template?.body ?? []) {
          collectLoopRefs(c as BuildNode, refs)
        }
      }
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

function formatConstDecl(decl: { name: string; value: PropValue; isUseState?: boolean; shared?: boolean; sharedKey?: string; sharedRead?: boolean }): string {
  // 共享只读 binding（无 useState 的 shared）→ 订阅切片取值（解构丢弃 setter，
  // 因 useSharedState 返回 [value, setter] 元组对齐 useState）
  if (decl.sharedRead && decl.sharedKey) {
    return `const [${decl.name}] = useSharedState('${decl.sharedKey}');`
  }
  // 共享 useState（path 命中 eventMutatedPaths）→ useSharedState（订阅 store + setter 写 store）
  if (decl.isUseState && decl.shared && decl.sharedKey) {
    const setter = 'set' + decl.name.charAt(0).toUpperCase() + decl.name.slice(1)
    return `const [${decl.name}, ${setter}] = useSharedState('${decl.sharedKey}');`
  }
  const valueStr = serializeForConstValue(decl.value)
  if (decl.isUseState) {
    const setter = 'set' + decl.name.charAt(0).toUpperCase() + decl.name.slice(1)
    return `const [${decl.name}, ${setter}] = useState(${valueStr});`
  }
  return `const ${decl.name} = ${valueStr};`
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
    // binding/computed → 裸引用（与 jsxEmitter.emitValue 共用 bindingRef，规则只在一处）。
    // const 值已在对象字面量内，裸引用不包 {}（否则 key: {expr} 的 {} 是块语句，语法非法）。
    if (v.type === 'binding' || v.type === 'computed') {
      return bindingRef(v)
    }
    if (typeof v.type === 'string' && typeof v.props === 'object' && v.props !== null) {
      return serializeComponentConst(v)
    }
    // RenderFnValue → 内联渲染函数（按当前 lvl 缩进传递）
    if (v.type === 'renderFn') {
      const paramsArr: Array<{ name: string; dataSource?: any; dataField?: string }> = v.params ?? []
      const dataSourceParam = paramsArr.find((p: any) => p.dataSource)
      const dataSourceName: string = dataSourceParam?.name ?? ''
      const dataField: string | undefined = dataSourceParam?.dataField
      const dataAccessor: string = dataField ? `${dataSourceName}.${dataField}` : dataSourceName
      const bodyOpts = {
        inRenderFnBody: !!dataSourceName,
        renderFnDataVarName: dataAccessor,
        useCssModules: constEmit.useCssModules,
        cssModuleVarName: constEmit.cssModuleVarName,
      }
      return serializeRenderFnBody(v, bodyOpts, lvl)
    }
    // BuildNode（kind: 'component'）→ JSX 元素。
    // - 有 node-field children（烘焙 Menu 树等嵌套子树）→ 走 emitNode：含 children 递归（数组 join
    //   无括号 + TextNode 裸文本 + 缩进 + dotted tag），与 slotNode→emitNode 路径同源、输出一致。
    // - 无 children 的叶子（resolveIcon 图标等）仍走 serializeComponentConst（自闭合，保持原行为）。
    if (v.kind === 'component' && typeof v.tag === 'string' && typeof v.props === 'object') {
      if (v.children) {
        return emitNode(v as BuildNode, { useCssModules: constEmit.useCssModules, emitId: false })
      }
      return serializeComponentConst(v)
    }
    // 纯对象 → 美化多行序列化（智能 key 引号 + 缩进）
    const isPropValueType = ['binding', 'computed', 'literal', 'varRef', 'rawExpr', 'renderFn', 'slotNode'].includes(v.type)
    if (!isPropValueType && !Array.isArray(value) && typeof value === 'object' && !v.__node) {
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

/**
 * 序列化 const 值内的组件 JSX（BuildNode kind:'component' 或 reactElement {type,props}）→ 自闭合/带 children 标签。
 * 合并自原 serializeBuildNodeComponent（BuildNode）+ serializeReactElement（reactElement）。
 *
 * - tagName：v.tag（BuildNode）或 v.type（reactElement）
 * - children prop → childrenPart（serializeForConstValue）；key 跳过
 * - className：CSS Modules + v.id + string → styles.{id}（classNameProp 别名，与 jsx-emitter emitClassName 对齐）
 * - selfClosing：强制自闭合（即使有 children prop）；BuildNode props 一般无 children prop，故原 serializeBuildNodeComponent 行为不变
 */
function serializeComponentConst(v: { tag?: string; type?: string; props: Record<string, any>; selfClosing?: boolean; id?: string }): string {
  const tagName = v.tag ?? v.type ?? ''
  const props = v.props ?? {}
  const propParts: string[] = []
  let childrenPart: string | null = null

  for (const [k, vv] of Object.entries(props)) {
    if (k === 'children') {
      childrenPart = serializeForConstValue(vv)
      continue
    }
    if (k === 'key') continue
    if ((k === 'className' || k === 'class') && constEmit.useCssModules && v.id && typeof vv === 'string') {
      const cnKey = (v as any).classNameProp ?? 'className'
      propParts.push(`${cnKey}={${cssModuleRef(constEmit.cssModuleVarName, v.id)}}`)
      continue
    }
    if (vv === true) propParts.push(k)
    else if (vv === false || vv === null || vv === undefined) continue
    else if (typeof vv === 'string') propParts.push(`${k}=${JSON.stringify(vv)}`)
    else if (typeof vv === 'number' || typeof vv === 'boolean') propParts.push(`${k}={${vv}}`)
    else propParts.push(`${k}={${serializeForConstValue(vv, 0, true)}}`)
  }

  const propsStr = propParts.join(' ')
  const attrs = propsStr ? ' ' + propsStr : ''
  if (childrenPart && childrenPart !== 'null' && !v.selfClosing) {
    return `<${tagName}${attrs}>${childrenPart}</${tagName}>`
  }
  return `<${tagName}${attrs} />`
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
    // 递归普通对象键。跳过 loopScope：遍历期反向引用字段（node.loopScope.loopNode 指回父循环，
    // 父 template 又含本节点 → 天然环），不属于可序列化值结构，走入爆栈。
    for (const [k, item] of Object.entries(v)) {
      if (k === 'loopScope') continue
      walk(item)
    }
  }
  for (const val of values) walk(val)
}

function headerComment(pageName: string): string {
  return `/**\n * ${pageName} 页面（自动生成，请勿手动修改）\n */`
}
