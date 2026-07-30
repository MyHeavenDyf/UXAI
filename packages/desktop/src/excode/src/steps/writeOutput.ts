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

import { Step } from '../core/step'
import type { PipelineContext } from '../pipeline/pipelineContext'

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

    console.log(`  ℹ  WriteOutput: 共 ${ctx.outputFiles.length} 个产出文件`)
  }

  /** 递归收集 templates 目录下的所有文件到 ctx.outputFiles。 */
  #collectTemplateFiles(ctx: PipelineContext, srcDir: string, rel: string): void {
    if (!fs.existsSync(srcDir)) return

    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(srcDir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        this.#collectTemplateFiles(ctx, full, relPath)
      } else if (entry.isFile()) {
        const content = fs.readFileSync(full, 'utf-8')
        ctx.outputFiles.push({ path: relPath, content })
      }
    }
  }
}
