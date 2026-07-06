/**
 * 步骤：WriteOutput — 收集产出文件
 *
 * 将管线生成的所有内容收集到 ctx.outputFiles 数组。
 * 收集模板文件 + 路由 + 样式 + 页面组件，供后续打包或写入磁盘。
 *
 * 生成的文件结构：
 *   index.html
 *   vite.config.js
 *   package.json
 *   src/
 *     styles/variables.less
 *     routes/index.jsx
 *     pages/{pageName}/
 *       index.jsx
 *       state.js
 *       components/*.jsx
 *       styles/*.less
 */
import { Step } from '../core/Step';
import type { PipelineContext } from '../pipeline/PipelineContext';
import fs from 'fs';
import path from 'path';

export class WriteOutput extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    ctx.outputFiles = [];

    // 1. 收集模板文件
    const templateDir = path.resolve(ctx.config.templateDir || './templates');
    this._collectTemplateFiles(ctx, templateDir, '');

    // 2. 写路由文件
    if (ctx.routeResult) {
      for (const file of ctx.routeResult.routeFiles) {
        ctx.outputFiles.push({
          path: `src/routes/${file.fileName}`,
          content: file.content,
        });
      }
    }

    // 3. 写全局 LESS 变量
    if (ctx.styleResults && ctx.styleResults.length > 0) {
      for (const pageStyle of ctx.styleResults) {
        if (pageStyle.globalLess) {
          ctx.outputFiles.push({
            path: 'src/styles/variables.less',
            content: pageStyle.globalLess,
          });
          break;
        }
      }
    }

    // 4. 写每页文件
    for (const gen of ctx.generatedPages) {
      const { pageName, componentFiles, pageComponent, stateFile } = gen as any;

      // 页面主文件
      if (pageComponent) {
        ctx.outputFiles.push({
          path: `src/pages/${pageName}/${pageComponent.fileName}`,
          content: pageComponent.content,
        });
      }

      // state.js
      if (stateFile) {
        ctx.outputFiles.push({
          path: `src/pages/${pageName}/${stateFile.fileName}`,
          content: stateFile.content,
        });
      }

      // 组件文件
      for (const file of componentFiles) {
        ctx.outputFiles.push({
          path: `src/pages/${pageName}/components/${file.fileName}`,
          content: file.content,
        });
      }

      // 样式文件
      const pageStyle = ctx.styleResults.find((s: any) => s.pageName === pageName);
      if (pageStyle) {
        for (const file of pageStyle.lessFiles) {
          ctx.outputFiles.push({
            path: `src/pages/${pageName}/styles/${file.fileName}`,
            content: file.content,
          });
        }

        // 页面级 LESS
        const pageLessContent = pageStyle.pageRules && pageStyle.pageRules.length > 0
          ? `@import '../../../styles/variables.less';\n\n${pageStyle.pageRules.map((r: any) =>
              `${r.selector} {\n${r.declarations.map((d: any) =>
                d.value ? `  ${d.prop}: ${d.value};` : `  ${d.prop}`
              ).join('\n')}\n}`
            ).join('\n\n')}\n`
          : `@import '../../../styles/variables.less';\n\n.${pageName}Page_style {\n  min-height: 100vh;\n}\n`;
        ctx.outputFiles.push({
          path: `src/pages/${pageName}/styles/${pageName}.less`,
          content: pageLessContent,
        });
      }
    }

    console.log(`  ℹ  已收集 ${ctx.outputFiles.length} 个产出文件`);
  }

  /**
   * 递归收集模板目录下的文件
   */
  _collectTemplateFiles(ctx: PipelineContext, srcDir: string, relativePath: string): void {
    if (!fs.existsSync(srcDir)) {
      console.warn(`  [WriteOutput] 模板目录 ${srcDir} 不存在，跳过`);
      return;
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'components') continue; // 跳过默认 components 目录

      const fullPath = path.join(srcDir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        this._collectTemplateFiles(ctx, fullPath, relPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        ctx.outputFiles.push({ path: relPath, content });
      }
    }
  }
}