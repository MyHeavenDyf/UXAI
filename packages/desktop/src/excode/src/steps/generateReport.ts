/**
 * Step 8: GenerateReport — 把生成汇总写到控制台（不再产出 markdown 文件）
 *
 * 调用方不期望产物里夹一份报告 —— outputFiles 应是纯净的代码。
 * 把 buildStatsFromContext / buildReportMarkdown 留作纯函数，console.log 用。
 *
 * ctx.generationReport 不再写入（保留字段仅供向后兼容 / 调试）。
 */

import { Step } from '../core/step'
import type { PipelineContext } from '../pipeline/pipelineContext'
import { buildStatsFromContext, buildReportMarkdown } from '../codegen/reportGenerator'

export class GenerateReport extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    try {
      const stats = buildStatsFromContext(ctx)
      const content = buildReportMarkdown(stats)

      // 调日志输出（不再落盘）
      console.log('\n──────── 生成报告 ────────')
      console.log(content)
      console.log('──────── /生成报告 ────────\n')

      // 兼容字段；不参与 outputFiles
      ctx.generationReport = content
    } catch (err: any) {
      console.warn(`  [warn] GenerateReport: 报告生成失败 (${err.message})`)
      ctx.generationReport = ''
    }
  }
}
