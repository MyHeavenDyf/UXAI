/**
 * 步骤：RegisterComponents — 注册组件映射
 *
 * 通过 mappingRegistry 统一注册表加载组件映射，注入 ComponentRegistry。
 * 不再使用运行时动态路径查找和 import。
 *
 * ## 映射文件存放规则
 *
 * config/mappings/{targetLib}/
 *   index.ts          ← 入口，手动 import 每个组件映射并集中导出
 *   Table.ts
 *
 * ## 映射文件格式
 *
 * 每个文件使用 ESM 导出声明式映射定义或纯 transform 函数。
 * 详见 mapping 目录中各文件的具体实现。
 */
import { mappingRegistry } from '../../config/mappings/index';
import { Step } from '../core/Step';
import type { PipelineContext } from '../pipeline/PipelineContext';

export class RegisterComponents extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const targetLib = ctx.targetLib || 'eview-react';
    const registry = ctx.registry;

    const mappings = (mappingRegistry as Record<string, any>)[targetLib];
    if (!mappings) {
      console.warn(`  [warn] 目标组件库 "${targetLib}" 未在 mappingRegistry 中注册`);
      return;
    }

    if (typeof mappings === 'object') {
      registry.loadMappings(mappings);
      const count = Object.keys(mappings).length;
      console.log(`  ℹ  加载了 ${count} 个组件映射 (${targetLib})`);
    }

    const stats = registry.getStats();
    console.log(`  ℹ  注册表中 ${stats.registeredCount} 个组件可用`);
  }
}