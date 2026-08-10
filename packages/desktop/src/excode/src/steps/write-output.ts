/**
 * Step 7: WriteOutput — 收集并组装最终输出文件清单
 *
 * 顺序：
 *   1. 复制 templates/ 目录整树（递归扫描）
 *   2. 追加路由文件（来自 Step 6）
 *   3. 追加页面文件（来自 Step 5，ctx.generatedFiles）
 *   4. 追加样式产物（*.module.less / *.less）
 *
 * 注：generation-report 不再产出 markdown 文件（Step 8 已改为只在控制台打印）。
 * 输出 ctx.outputFiles 应是纯净的项目代码，不含任何 manifest 文件。
 *
 * 输出到 ctx.outputFiles。cli 把这里的结果落盘。
 */

import fs from 'fs'
import path from 'path'

import { Step } from '../core/step-base'
import type { PipelineContext } from '../pipeline/pipeline-context'
import { generateTailwindBaseCss } from '../../../main/tailwind-base-css'

export class WriteOutput extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    ctx.outputFiles = []

    // 1. templates 目录（整目录复制）
    const templateDir = path.resolve(ctx.config?.templateDir || './templates')
    this.#collectTemplateFiles(ctx, templateDir, '')

    // 2. 路由
    if (ctx.routeResult?.routeFiles) {
      for (const f of ctx.routeResult.routeFiles) {
        ctx.outputFiles.push({
          path: `src/routes/${f.fileName}`,
          content: f.content,
        })
      }
    }

    // 3. 页面文件（Step 5 产物，generatedFiles 已含路径如 src/pages/{pageName}/index.jsx）
    if (ctx.generatedFiles) {
      ctx.outputFiles.push(...ctx.generatedFiles)
    }

    // 4. 样式产物（*.module.less / *.less）
    if (ctx.styleResults && ctx.styleResults.length > 0) {
      for (const ps of ctx.styleResults) {
        for (const lf of ps.lessFiles) ctx.outputFiles.push(lf)
      }
    }

    // 5. 共享 tailwind-base.css（@layer 顺序 + theme + preflight + @property + @layer properties）
    //    聚合全导出用到的候选类，产出 base CSS；入口 main.tsx 引一次，使 .module.less 里
    //    的 var(--color-primary)/var(--spacing)/var(--tw-shadow) 等可解析、preflight 生效。
    const allCandidates = new Set<string>()
    if (ctx.styleResults) for (const ps of ctx.styleResults) for (const c of ps.allCandidates) allCandidates.add(c)
    ctx.outputFiles.push({
      path: 'src/styles/tailwind-base.css',
      content: generateTailwindBaseCss([...allCandidates]),
    })

    console.log(`  ℹ  WriteOutput: 共 ${ctx.outputFiles.length} 个产出文件`)
  }

  /**
   * 递归收集 templates 目录下的所有文件到 ctx.outputFiles。
   *
   * 防爆栈兜底：用 realpath 去重，遇到符号链接/junction 环（Windows junction、
   * node_modules 符号链接等）或 templateDir 误解析到含环目录时直接返回，不再深入，
   * 避免 #collectTemplateFiles 无限递归 → RangeError: Maximum call stack size exceeded。
   * 同时跳过 node_modules：模板骨架不应包含它，命中说明 templateDir 解析异常，
   * 跳过可避免扫进成千上万文件（即便无环也慢且无意义）。
   */
  #collectTemplateFiles(ctx: PipelineContext, srcDir: string, rel: string, seen: Set<string> = new Set()): void {
    if (!fs.existsSync(srcDir)) return

    // realpath 去重，断符号链接/junction 环
    let real: string
    try {
      real = fs.realpathSync(srcDir)
    } catch {
      real = srcDir
    }
    if (seen.has(real)) return
    seen.add(real)

    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      // 跳过 node_modules（模板骨架不应含；命中说明 templateDir 解析异常）
      if (entry.name === 'node_modules') continue
      const full = path.join(srcDir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        this.#collectTemplateFiles(ctx, full, relPath, seen)
      } else if (entry.isFile()) {
        const content = fs.readFileSync(full, 'utf-8')
        ctx.outputFiles.push({ path: relPath, content })
      }
    }
  }
}
