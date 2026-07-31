/**
 * Step 5: FileGenerator — 代码生成（处理层 + 序列化层）
 *
 * 阶段：
 *   state-builder   → state.js 纯数据 + loop enrichment 三条分支
 *   tree-finalizer  → 树上 VarRef 替换 + LoopDescriptor 路由 + Extract 分发 + propRoute 消费
 *   import-collector → 按文件维度收集 import（含 props 中嵌入的 BuildNode）
 *   jsx-emitter     → BuildNode → JSX 字符串
 *   file-assembler  → 拼装三种文件模板（index.jsx / modules/{Name}.jsx / components/{Name}Template.jsx）+ state.js
 *
 * 输出 ctx.generatedFiles（Step 5 原始产物）。
 * ctx.outputFiles 的最终组装由 Step 7 WriteOutput 接管。
 */

import { Step } from '../core/step'
import type { PipelineContext } from '../pipeline/pipeline-context'
import type { MappedPage } from '../pipeline/pipeline-context'
import { buildState, type StateBuilderResult } from '../codegen/state-builder'
import { finalizeTree, type TreeFinalizerResult } from '../codegen/tree-finalizer'
import { assembleAllFiles } from '../codegen/file-assembler'
import { fileKeyOf } from '../core/file-keys'
import {
  StyleConverter,
  buildStyleImportMap,
  collectRulesFromValue,
  appendConstRules,
  toPascalCase,
  type LessRule,
  type StyleResult,
} from '../codegen/style-converter'

export class FileGenerator extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const stateResults = new Map<string, StateBuilderResult>()
    const finalResults = new Map<string, TreeFinalizerResult>()
    const styleResults: StyleResult[] = []
    const styleImportMap = new Map<string, string>()
    const cssModules = ctx.config?.css !== false
    const emitId = ctx.config?.id !== false   // 默认 true，可翻 false
    const generatedFiles: Array<{ path: string; content: string }> = []

    for (const mappedPage of ctx.mappedPages) {
      const stateResult = buildState(mappedPage as MappedPage)
      stateResults.set(mappedPage.pageName, stateResult)

      const finalResult = finalizeTree(mappedPage as any, stateResult)
      finalResults.set(mappedPage.pageName, finalResult)

      // 样式提取：在 tree-finalizer 之后用 final extractedFiles（已过滤掉被 mapping
      // 消化 / force-inline 的循环模板），避免生成有 .less 无 .tsx 的孤儿文件。
      // （原先在 GenerateStyles 步骤用 mp.extracts，那时 treeFinalizer 还没过滤。）
      const sc = new StyleConverter()
      const styleResult = sc.convertPage(
        mappedPage.pageName,
        finalResult.mainFile.rootTree,
        finalResult.extractedFiles,
        { cssModules },
      )
      styleResults.push(styleResult)
      // 增量构建 styleImportMap（assembleAllFiles 按本页 jsx 路径查相对 .less 路径）
      for (const [k, v] of buildStyleImportMap([styleResult], cssModules)) {
        styleImportMap.set(k, v)
      }

      const files = assembleAllFiles(
        mappedPage.pageName,
        stateResult,
        finalResult,
        { styleImportMap, emitId }
      )
      generatedFiles.push(...files)

      // 被提升为文件顶部 const 的值（jsxLiteralConsts / enrichmentConsts /
      // moduleTopConsts）已脱离主树，#collectRules 走主树时拿不到它们的 className。
      // state-builder / tree-finalizer 产物就绪后，在此补全对应 lessFile 的规则。
      this.#augmentStyleFromConsts(mappedPage.pageName, stateResult, finalResult, styleResult)
    }

    ;(ctx as any).stateResults = stateResults
    ;(ctx as any).finalResults = finalResults
    ;(ctx as any).styleResults = styleResults
    ;(ctx as any).styleImportMap = styleImportMap
    ctx.generatedFiles = generatedFiles
  }

  /**
   * 从各文件单元的 const 值中收集样式规则，并入对应 lessFile。
   *   - 主页面：main FileUnit 的 jsxLiteralConsts / enrichmentConsts + mainFile.moduleTopConsts
   *   - 抽取文件（module / loopTemplate）：对应 FileUnit + ext.moduleTopConsts
   */
  #augmentStyleFromConsts(
    pageName: string,
    stateResult: StateBuilderResult,
    finalResult: TreeFinalizerResult,
    styleResult: StyleResult
  ): void {
    // 主页面
    {
      const rules: LessRule[] = []
      const mainUnit = stateResult.fileUnits.get(fileKeyOf.main())
      if (mainUnit) {
        for (const jlc of mainUnit.jsxLiteralConsts) collectRulesFromValue(jlc.value, rules)
        for (const ec of mainUnit.enrichmentConsts) collectRulesFromValue(ec.value, rules)
      }
      for (const decl of finalResult.mainFile.moduleTopConsts) {
        collectRulesFromValue(decl.value, rules)
      }
      appendConstRules(styleResult, toPascalCase(pageName), rules)
    }

    // 抽取文件
    for (const ext of finalResult.extractedFiles) {
      const fk = ext.purpose === 'module'
        ? fileKeyOf.module(ext.componentName)
        : fileKeyOf.loopTemplate(ext.componentName)
      const unit = stateResult.fileUnits.get(fk)
      const rules: LessRule[] = []
      if (unit) {
        for (const jlc of unit.jsxLiteralConsts) collectRulesFromValue(jlc.value, rules)
        for (const ec of unit.enrichmentConsts) collectRulesFromValue(ec.value, rules)
      }
      for (const decl of (ext.moduleTopConsts ?? [])) {
        collectRulesFromValue(decl.value, rules)
      }
      appendConstRules(styleResult, ext.componentName, rules)
    }
  }
}
