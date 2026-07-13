/**
 * 步骤：GenerateRoutes — 生成路由配置
 *
 * 根据 ctx.generatedPages 的页面列表生成 React Router 路由文件。
 * 输出存入 ctx.routeResult。
 */
import { Step } from '../core/Step';
import type { PipelineContext } from '../pipeline/PipelineContext';

export class GenerateRoutes extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const pageNames = ctx.generatedPages.map((p: any) => p.pageName);
    if (pageNames.length === 0) {
      throw new Error('[GenerateRoutes] 没有可生成路由的页面');
    }

    const routeConfig = ctx.config.route || {};
    const prefix = routeConfig.prefix || '/';
    const homeRedirect = routeConfig.homeRedirect !== false;

    const content = this._generateRouterContent(pageNames, prefix, homeRedirect);

    ctx.routeResult = {
      routeFiles: [{ fileName: 'index.jsx', content }],
    };

    console.log(`  ℹ  已生成路由文件（${pageNames.length} 个页面）`);
  }

  _generateRouterContent(pageNames: string[], prefix: string, homeRedirect: boolean): string {
    const lines: string[] = [];

    lines.push("import { createBrowserRouter, Navigate } from 'react-router-dom';");
    lines.push("import App from '../App';");
    lines.push('');

    for (const name of pageNames) {
      const compName = this._capitalize(name) + 'Page';
      lines.push(`import ${compName} from '../pages/${name}';`);
    }

    lines.push('');
    lines.push('const router = createBrowserRouter([');
    lines.push('  {');
    lines.push("    path: '/',");
    lines.push('    element: <App />,');
    lines.push('    children: [');
    lines.push(`      { index: true, element: <Navigate to="${prefix}${pageNames[0]}" replace /> },`);

    for (const name of pageNames) {
      const compName = this._capitalize(name) + 'Page';
      lines.push(`      { path: '${prefix}${name}', element: <${compName} /> },`);
    }

    lines.push('    ],');
    lines.push('  },');
    lines.push(']);');
    lines.push('');
    lines.push('export default router;');

    return lines.join('\n');
  }

  _capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}