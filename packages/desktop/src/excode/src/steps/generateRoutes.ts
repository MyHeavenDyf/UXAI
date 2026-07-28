/**
 * Step 6: GenerateRoutes — 生成 React Router 路由配置
 *
 * 输入 ctx.mappedPages（pageName 列表）
 * 写入 ctx.routeResult = { routeFiles: [{ fileName: 'index.jsx', content }] }
 *
 * 产物由 WriteOutput（Step 7）写到 `src/routes/index.jsx`。
 */

import { Step } from '../core/step'
import type { PipelineContext } from '../pipeline/pipelineContext'
import { buildRouterFile } from '../codegen/routeGenerator'

export class GenerateRoutes extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const pageNames: string[] = ctx.mappedPages.map((p: any) => p.pageName)

    if (pageNames.length === 0) {
      console.warn('  [warn] GenerateRoutes: 没有可生成路由的页面')
      ctx.routeResult = { routeFiles: [] }
      return
    }

    const routeConfig = (ctx.config?.route ?? {}) as { prefix?: string; homeRedirect?: boolean }
    const homeRedirect = routeConfig.homeRedirect !== false

    ctx.routeResult = {
      routeFiles: [
        {
          fileName: 'index.tsx',
          content: buildRouterFile(pageNames, { homeRedirect }),
        },
      ],
    }
  }
}
