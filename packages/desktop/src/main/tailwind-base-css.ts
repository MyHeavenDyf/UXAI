/**
 * tailwind-base-css — 用 Tailwind v4 真正的 compile() API 一次性烤出完整 CSS
 *
 * 目的：导出的目标项目不依赖 Tailwind 运行时，但样式与 previewpc 完全一致。
 * 在导出时刻调用 Tailwind 的 compile() API（与 previewpc 的 @tailwindcss/browser
 * 同源），输入相同的 `@import "tailwindcss"` + hui-theme.css，输出含
 * preflight + theme + utilities + @property + layer 顺序的完整 CSS。
 *
 * main/hui-theme.css 与 previewpc/src/assets/style/hui-theme.css 同源（MD5 一致），
 * 因此导出产物的样式与 previewpc 等价。
 *
 * 产物落到 src/styles/tailwind-base.css，由模板 main.tsx 一次性 import。
 * JSX 写原始 className（如 `className="flex p-4"`），CSS 选择器 `.flex { ... }`
 * 直接命中——不再需要 CSS Modules 做 per-element .less 转换。
 */

import { compile } from 'tailwindcss'
import _tailwindIndexCss from 'tailwindcss/index.css?raw'
import _huiThemeCss from './hui-theme.css?raw'

// 模块加载时一次性建好 compiler；build() 是同步的，后续每次导出直接调用。
let buildFn: ((candidates: string[]) => string) | null = null
try {
  const inputCss = `@import "tailwindcss";\n${_huiThemeCss}`
  const result = await compile(inputCss, {
    base: '',
    loadStylesheet: async (id: string) => {
      if (id === 'tailwindcss') return { path: id, base: '', content: _tailwindIndexCss }
      throw new Error(`cannot resolve stylesheet ${id}`)
    },
  })
  buildFn = result.build
} catch (e) {
  console.error('[tailwind-base-css] compile init failed:', e)
}

/**
 * 生成导出项目共享的 tailwind-base.css。
 *
 * 内部调用 Tailwind compile().build(candidates)：
 *   - preflight（浏览器重置）
 *   - @theme 变量（含 HUI 主题覆盖）
 *   - utilities（按候选类生成，含 variant: hover/md:/[&:…] 等）
 *   - @property 注册 + 兼容回退层
 *   - 正确的 @layer 顺序
 *
 * 与 previewpc 运行时输出等价，因为共用同一份 compile + 同一份 hui-theme.css。
 */
export async function generateTailwindBaseCss(candidates: string[]): Promise<string> {
  if (!buildFn) {
    return '/* tailwind-base-css: compiler not initialized */\n'
  }
  return buildFn(candidates)
}
