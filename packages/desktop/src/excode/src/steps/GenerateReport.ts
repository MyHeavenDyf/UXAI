/**
 * 步骤：GenerateReport — 生成报告
 *
 * 汇总所有页面的生成结果，输出 .md 报告文件。
 * 仅在 CLI 模式（ctx.config.mode === 'cli'）下写磁盘，API 模式跳过 IO。
 * 报告内容包括：页面概览、组件统计、样式统计、失败详情。
 */
import { Step } from '../core/Step';
import type { PipelineContext } from '../pipeline/PipelineContext';
import fs from 'fs';
import path from 'path';

export class GenerateReport extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const pageResults = this._buildPageResults(ctx);
    const content = this._generateReport(pageResults, dateStr);

    // 仅在 CLI 模式下写磁盘
    if (ctx.config.mode === 'cli') {
      const outputDir = path.resolve(ctx.config.outputDir || './output');
      const reportPath = path.join(outputDir, 'generation-report.md');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, content, 'utf-8');
      console.log('  [report] generation-report.md');
    } else {
      // API 模式下将报告内容存入 ctx，供外部按需消费
      ctx.generationReport = content;
    }
  }

  _buildPageResults(ctx: PipelineContext): any[] {
    const results: any[] = [];
    for (const gen of ctx.generatedPages || []) {
      const pageName = gen.pageName;
      const styleResult = (ctx.styleResults || []).find((s: any) => s.pageName === pageName);

      results.push({
        pageName,
        success: true,
        error: null,
        errorStack: null,
        componentStats: gen.componentStats || { registeredCount: 0, fallbackCount: 0, htmlCount: 0 },
        styleStats: styleResult?.styleStats || null,
        components: gen,
      });
    }
    return results;
  }

  _generateReport(pageResults: any[], dateStr: string): string {
    const successPages = pageResults.filter(p => p.success);
    const failedPages = pageResults.filter(p => !p.success);

    const totalTransformed = pageResults.reduce((sum: number, p: any) => sum + (p.componentStats?.registeredCount || 0), 0);
    const totalFallback = pageResults.reduce((sum: number, p: any) => sum + (p.componentStats?.fallbackCount || 0), 0);
    const totalHtml = pageResults.reduce((sum: number, p: any) => sum + (p.componentStats?.htmlCount || 0), 0);
    const totalCompCalls = totalTransformed + totalFallback + totalHtml;

    const totalStyleClasses = pageResults.reduce((sum: number, p: any) => sum + (p.styleStats?.totalClasses || 0), 0);
    const totalRecognizedStyles = pageResults.reduce((sum: number, p: any) => sum + (p.styleStats?.recognizedCount || 0), 0);
    const totalUnrecognizedStyles = pageResults.reduce((sum: number, p: any) => sum + (p.styleStats?.unrecognizedOccurrences || 0), 0);
    const totalUnrecognizedUnique = pageResults.reduce((sum: number, p: any) => sum + (p.styleStats?.unrecognizedCount || 0), 0);

    const lines: string[] = [];
    lines.push('# 生成报告');
    lines.push('');
    lines.push(`> **生成时间:** ${dateStr}`);
    lines.push('');

    // 概览
    lines.push('## 概览');
    lines.push('');

    lines.push('### 📋 页面');
    lines.push('');
    lines.push('| 项目 | 数量 |');
    lines.push('|------|------|');
    lines.push(`| 页面总数 | ${pageResults.length} |`);
    lines.push(`| ✅ 成功 | ${successPages.length} |`);
    lines.push(`| ❌ 失败 | ${failedPages.length} |`);
    lines.push('');

    lines.push('### ⚙️ 组件');
    lines.push('');
    lines.push('| 类别 | 数量 | 占比 |');
    lines.push('|------|------|------|');
    const htmlPct = totalCompCalls > 0 ? `(${Math.round(totalHtml / totalCompCalls * 100)}%)` : '';
    const regPct = totalCompCalls > 0 ? `(${Math.round(totalTransformed / totalCompCalls * 100)}%)` : '';
    const fallPct = totalCompCalls > 0 ? `(${Math.round(totalFallback / totalCompCalls * 100)}%)` : '';
    lines.push(`| HTML 元素 | ${totalHtml} | ${htmlPct} |`);
    if (totalTransformed > 0) {
      lines.push(`| 已注册组件（已转换） | ${totalTransformed} | ${regPct} |`);
    }
    lines.push(`| 默认 A2UI（待注册） | ${totalFallback} | ${fallPct} |`);
    if (totalCompCalls > 0) {
      lines.push(`| **组件调用总计** | **${totalCompCalls}** | |`);
    }
    lines.push('');

    lines.push('### 🎨 样式');
    lines.push('');
    lines.push('| 项目 | 数量 |');
    lines.push('|------|------|');
    lines.push(`| 总类名（含重复） | ${totalStyleClasses} |`);
    if (totalRecognizedStyles > 0) {
      lines.push(`| ✅ 已识别 | ${totalRecognizedStyles} |`);
    }
    if (totalUnrecognizedStyles > 0) {
      lines.push(`| ❌ 未识别（出现次数） | ${totalUnrecognizedStyles} |`);
    }
    if (totalUnrecognizedUnique > 0) {
      lines.push(`| ❌ 未识别（去重） | ${totalUnrecognizedUnique} |`);
    }
    lines.push('');

    // 失败页面
    if (failedPages.length > 0) {
      lines.push('### ⚠️ 失败页面');
      lines.push('');
      for (const p of failedPages) {
        lines.push(`- **${p.pageName}**: ${p.error}`);
      }
      lines.push('');
    }

    // 详细结果
    lines.push('---');
    lines.push('');
    lines.push('## 详细结果');
    lines.push('');

    for (const p of pageResults) {
      const icon = !p.success ? '❌' : '✅';
      const statusLabel = !p.success ? ' (失败)' : '';
      lines.push(`### ${icon} ${p.pageName}${statusLabel}`);
      lines.push('');

      if (!p.success) {
        lines.push(`**错误信息:** \`${p.error}\``);
        lines.push('');
        if (p.errorStack) {
          lines.push('```');
          lines.push(p.errorStack.split('\n').slice(0, 10).join('\n'));
          lines.push('```');
          lines.push('');
        }
        continue;
      }

      // 组件统计
      const cs = p.componentStats;
      const compFileCount = p.components?.componentFiles?.length || 0;

      if (cs) {
        lines.push('**组件统计:**');
        lines.push('');
        lines.push('| 类别 | 数量 |');
        lines.push('|------|------|');
        lines.push(`| 生成的组件文件 | ${compFileCount} |`);
        if (cs.htmlCount > 0) {
          lines.push(`| HTML 元素 | ${cs.htmlCount} |`);
        }
        if (cs.registeredCount > 0) {
          lines.push(`| 已注册组件 | ${cs.registeredCount} |`);
        }
        if (cs.fallbackCount > 0) {
          lines.push(`| 默认 A2UI (注释) | ${cs.fallbackCount} |`);
        }
        lines.push('');
      }

      // 样式统计
      const ss = p.styleStats;
      if (ss && ss.totalClasses > 0) {
        lines.push('**样式统计:**');
        lines.push('');
        lines.push('| 类别 | 数量 |');
        lines.push('|------|------|');
        lines.push(`| 总类名 | ${ss.totalClasses} |`);
        lines.push(`| 已识别 | ${ss.recognizedCount} |`);
        lines.push(`| 未识别 | ${ss.unrecognizedCount} |`);
        if (ss.unrecognizedCount > 0) {
          lines.push(`| 未识别的类 | \`${ss.unrecognizedClasses.join('`, `')}\` |`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}