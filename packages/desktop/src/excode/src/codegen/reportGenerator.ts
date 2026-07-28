/**
 * report-generator — 生成 generation-report.md
 *
 * 输入：从 PipelineContext 抽取 stats（页面级 stat 数据 + 文件清单）。
 * 输出：markdown 文本。
 *
 * 主要汇总：pages / state 字段数 / loops / extracted files。
 */

import type { PipelineContext } from '../pipeline/pipelineContext'
import type { StateBuilderResult } from './stateBuilder'
import type { TreeFinalizerResult } from './treeFinalizer'

export interface ReportPageStats {
  pageName: string
  stateFields: number
  loops: number
  loopsWithJSX: number
  extractedFiles: number
  files: string[]
}

export interface ReportStats {
  dateStr: string
  pageCount: number
  fileCount: number
  pages: ReportPageStats[]
}

/**
 * 从 ctx 构造一份 ReportStats。
 * 依赖 ctx.mappedPages / ctx.stateResults / ctx.finalResults / ctx.generatedFiles。
 */
export function buildStatsFromContext(
  ctx: PipelineContext,
  options: { dateStr?: string; generatedFiles?: Array<{ path: string; content: string }> } = {}
): ReportStats {
  const dateStr = options.dateStr ?? formatNow()
  const stateResults = (ctx as any).stateResults as Map<string, StateBuilderResult> | undefined
  const finalResults = (ctx as any).finalResults as Map<string, TreeFinalizerResult> | undefined
  const generatedFiles = options.generatedFiles ?? ctx.generatedFiles ?? []

  const pages: ReportPageStats[] = []
  for (const mp of ctx.mappedPages) {
    const pageName = (mp as any).pageName
    const stateResult = stateResults?.get(pageName)
    const finalResult = finalResults?.get(pageName)

    const stateFields = stateResult ? Object.keys(stateResult.newState).length : 0
    // loopEnrichmentMap 的大小反映发生过 enrichment 的循环数
    const loops = stateResult?.loopEnrichmentMap.size ?? 0
    // 含 JSX 的循环数：从 fileUnits 收集所有 enrichmentConsts 中 containsJSX:true 的
    const loopsWithJSX = stateResult
      ? Array.from(stateResult.fileUnits.values()).reduce(
          (sum, unit) => sum + unit.enrichmentConsts.filter(e => e.containsJSX).length,
          0
        )
      : 0
    const extractedFiles = finalResult?.extractedFiles.length ?? 0

    const prefix = `src/pages/${pageName}/`
    const files = generatedFiles
      .filter(f => f.path.startsWith(prefix))
      .map(f => f.path.slice(prefix.length))
      .sort()

    pages.push({
      pageName,
      stateFields,
      loops,
      loopsWithJSX,
      extractedFiles,
      files,
    })
  }

  return {
    dateStr,
    pageCount: pages.length,
    fileCount: generatedFiles.length,
    pages,
  }
}

/** 把 ReportStats 序列化为 markdown。 */
export function buildReportMarkdown(stats: ReportStats): string {
  const lines: string[] = []

  lines.push('# 生成报告')
  lines.push('')
  lines.push(`> 生成时间：${stats.dateStr}`)
  lines.push('')

  // 概览
  lines.push('## 概览')
  lines.push('')
  lines.push('| 项目 | 数值 |')
  lines.push('|------|------|')
  lines.push(`| 页面数 | ${stats.pageCount} |`)
  lines.push(`| 产出文件数 | ${stats.fileCount} |`)
  lines.push('')

  // 详情
  lines.push('## 详细结果')
  lines.push('')
  for (const page of stats.pages) {
    lines.push(`### ${page.pageName}`)
    lines.push('')
    lines.push('| 类别 | 数值 |')
    lines.push('|------|------|')
    lines.push(`| state 字段数 | ${page.stateFields} |`)
    lines.push(`| loop 数（含 JSX） | ${page.loops}（${page.loopsWithJSX}） |`)
    lines.push(`| 抽取文件数 | ${page.extractedFiles} |`)
    lines.push(`| 产出文件数 | ${page.files.length} |`)
    lines.push('')
    if (page.files.length > 0) {
      lines.push('**产出文件清单**：')
      lines.push('')
      for (const f of page.files) {
        lines.push(`- \`${f}\``)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function formatNow(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}
