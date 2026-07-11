/**
 * 步骤：BuildTrees — 构建节点树 + 绑定解析 + 样式转换（三步合并）
 *
 * 合并原步骤 02/03/04 为单次页面遍历，消除中间 ctx 数据浪费。
 * 对每个页面数据：
 *   1. TreeBuilder.buildTree 构建 rootTree（传 splitMeta 在建树时同时识别 slot 根节点）
 *   2. BindingResolver.resolveNode 解析 state 绑定
 *   3. TailwindConverter.convertPage 提取样式 → LESS 文件
 *   4. 结果写 ctx.resolvedPages 和 ctx.styleResults
 *
 * 样式转换：
 *   TailwindConverter 直接调用 convertTailwindToCSS（顶部 import 手动切换 CLI/Electron 模式）。
 */
import { Step } from '../core/Step';
import { TreeBuilder } from '../parser/TreeBuilder';
import { BindingResolver } from '../resolver/BindingResolver';
import { TailwindConverter } from '../style/TailwindConverter';
import type { PipelineContext } from '../pipeline/PipelineContext';

export class BuildTrees extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    ctx.resolvedPages = [];
    ctx.styleResults = [];

    // 创建样式转换器（顶部 import 决定使用本地 tw-to-css 还是 Electron 主进程模块）
    const tailwindCvt = new TailwindConverter();

    for (const pageData of ctx.pagesData) {
      const { pageName, a2uiDoc, splitMeta } = pageData as any;

      // ── 1a. 建树 ──
      const moduleRoots: any[] = [];
      const rootTree = TreeBuilder.buildTree(
        a2uiDoc.rootId,
        a2uiDoc.elements,
        { splitMeta, moduleRoots }
      );
      const moduleTrees = TreeBuilder.getModuleTrees(moduleRoots);

      // ── 2a. 绑定解析 ──
      const slotRootIds = new Set(
        moduleTrees.map((m: any) => m.elements[0]?.id).filter(Boolean)
      );
      const bindings: any[] = [];

      const resolveNodeRef = (node: any, loopCtx: any, skipIds: any) =>
        BindingResolver.resolveNode(node, ctx.registry, skipIds, loopCtx, bindings, resolveNodeRef);

      const resolvedTree = resolveNodeRef(rootTree, false, slotRootIds);
      const resolvedModules = moduleTrees.map((mod: any) => ({
        id_prefix: mod.id_prefix,
        section_id: mod.section_id,
        elements: mod.elements.map((el: any) => resolveNodeRef(el, false, null)).filter(Boolean),
      }));

      ctx.resolvedPages.push({
        pageName,
        state: a2uiDoc.state || {},
        resolvedTree,
        resolvedModules,
        bindings,
      });

      // ── 3a. 样式转换 ──
      const result = tailwindCvt.convertPage(resolvedTree, resolvedModules, pageName);
      ctx.styleResults.push({
        pageName,
        lessFiles: result.lessFiles,
        globalLess: result.globalLess,
        pageRules: result.pageRules,
        styleStats: result.styleStats,
      });
    }

    const totalBindings = ctx.resolvedPages.reduce((s: number, p: any) => s + p.bindings.length, 0);
    const totalStyleClasses = ctx.styleResults.reduce((s: number, p: any) => s + p.styleStats.totalClasses, 0);
    console.log(`  ℐ  已构建 ${ctx.resolvedPages.length} 个页面，共 ${totalBindings} 个绑定，${totalStyleClasses} 个样式类名`);
  }
}