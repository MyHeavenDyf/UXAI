/**
 * 步骤：ReadPages — 读取页面源数据
 *
 * 优先从 ctx.pagesSourceData（API 传入的内存数据）读取，
 * 若无则降级从 pagesDir 文件系统读取（CLI 兼容）。
 * 两种模式统一通过 readFromData() 解析为内部标准格式。
 * 结果存入 ctx.pagesData，供后续步骤消费。
 */
import { Step } from '../core/Step';
import { PageReader } from '../reader/PageReader';
import type { PipelineContext } from '../pipeline/PipelineContext';
import path from 'path';

export class ReadPages extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    let inputData: any[];

    if (ctx.pagesSourceData && Array.isArray(ctx.pagesSourceData)) {
      // ── API 模式：直接使用内存数据 ──
      inputData = ctx.pagesSourceData;
      console.log(`  ℹ  从内存读取 ${inputData.length} 个页面`);
    } else {
      // ── CLI 模式：从文件系统读取 → 返回 HuiCodeInput[] ──
      const pagesDir = path.resolve(ctx.config.pagesDir || './pages-source');
      inputData = PageReader.readAll(pagesDir);
      console.log(`  ℹ  从文件系统读取 ${inputData.length} 个页面`);
    }

    // 统一通过 readFromData 解析为内部标准格式
    ctx.pagesData = PageReader.readFromData(inputData);
  }
}