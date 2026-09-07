/**
 * Step 5b: GenerateStyles — 从 mappedPages 提取 Tailwind 类 → .module.less
 *
 * 直接读 ctx.mappedPages（post-NodeMapper typed BuildNode）。比 tree-finalizer 更早，
 * 让 styleImportMap 在 FileGenerator assembleAllFiles 时可用（决定每个 JSX 文件是否
 * useCssModules + 注入 import styles ...）。
 *
 * 注入到 ctx：
 *   - ctx.styleResults     : StyleResult[]（每页）
 *   - ctx.styleImportMap   : Map<jsxFilePath, relativeCssModulePath>
 */

import { Step } from '../core/step'
import type { PipelineContext } from '../pipeline/pipelineContext'
import { StyleConverter, type StyleResult } from '../codegen/styleConverter'
import type { BuildNode } from '../core/nodeTypes'
import type { PendingExtractedFile } from '../codegen/treeFinalizer'

export class GenerateStyles extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const styleResults: StyleResult[] = []
    const cssModules = ctx.config?.css !== false

    for (const mp of ctx.mappedPages) {
      const rootTree = (mp as any).rootTree as BuildNode
      const extractedFiles = ((mp as any).extracts ?? []) as PendingExtractedFile[]

      try {
        const sc = new StyleConverter()
        const result = sc.convertPage(mp.pageName, rootTree, extractedFiles, { cssModules })
        styleResults.push(result)
      } catch (err: any) {
        console.warn(`  [warn] [${mp.pageName}] 样式提取失败 (${err.message})`)
      }
    }

    ctx.styleResults = styleResults
    ;(ctx as any).styleImportMap = buildStyleImportMap(styleResults, cssModules)
  }
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

/** 任意命名 → PascalCase（与 style-converter.ts 同实现） */
function toPascalCase(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}
