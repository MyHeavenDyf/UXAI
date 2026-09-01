/**
 * Step: GenerateThemeConfig — 生成主题配置文件 src/theme/config.ts
 *
 * 输入 ctx.theme（'light' | 'dark'，默认 'light'）。
 * 写入 ctx.generatedFiles（与页面文件同列，由 WriteOutput 落到产物 src/theme/config.ts）。
 *
 * 内容：export const DEFAULT_THEME = "<theme>"
 *   —— 该常量被静态模板 src/theme/useTheme.tsx 的 `import { DEFAULT_THEME } from './config'` 消费。
 *
 * 与库无关：config.ts 内容对两个库完全一致（仅主题值不同），useTheme.tsx 的库差异由各自静态模板承载。
 * 前置约定：调用方保证当前 targetLib 的模板目录下存在 src/theme/useTheme.tsx，本步骤不再校验。
 */

import { Step } from '../core/step-base'
import type { PipelineContext } from '../pipeline/pipeline-context'

export class GenerateThemeConfig extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const theme = ctx.theme || 'light'
    ctx.generatedFiles.push({
      path: 'src/theme/config.ts',
      content: `export const DEFAULT_THEME = "${theme}"\n`,
    })

    console.log(`  ℹ  GenerateThemeConfig: src/theme/config.ts (theme=${theme})`)
  }
}
