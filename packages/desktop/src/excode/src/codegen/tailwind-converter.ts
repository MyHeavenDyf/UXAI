/**
 * tailwind-converter — tailwind → CSS/LESS 转换器的统一导入入口
 *
 * 为什么集中到本文件：style-converter 及其它消费方都需要
 * convertTailwindToLessRule / generateLessContent / convertTailwindToCSS / LessRule。
 * 若每个文件各自从 lib/convertTailwindToCSS 或 main/tailwind-to-css 导入，
 * CLI/Electron 切换要在多处手动改，易漏且不同步。
 * 统一从本文件 re-export，只在下方两块之间切换，所有消费方自动跟随。
 *
 * ─── 手动切换 ───
 * 默认启用 Electron 模式（本库主要嵌入 Electron 应用，main/tailwind-to-css 由宿主提供）。
 * 注释/取消注释下方两个 import 块之一：
 *   - Electron 模式（默认）：启用 main/tailwind-to-css（Electron 主进程实现，与 excode 同步）
 *   - CLI 模式：启用 lib/convertTailwindToCSS
 *       （tailwindcss v4 __unstable__loadDesignSystem 本地实现，
 *        含响应式 variant——伪类/@media/dark/rtl 由 convertTailwindToLessRule 统一产出）
 *
 * 本仓库独立调试（cli.ts / jsonTest/run-batch.ts）时需手动切到 CLI 块：
 * 取消注释 CLI 块、注释 Electron 块。main/tailwind-to-css 在本仓库不存在，
 * 留在 Electron 默认会因模块找不到而无法在独立环境下运行。
 * 两个源是单文件同接口镜像，切换时只改本文件，勿在各消费方再各自切换。
 */

// ─── Electron 模式（默认启用）────────────────────────────────
import {
  convertTailwindToLessRule,
  generateLessContent,
  convertTailwindToCSS,
  type LessRule,
} from '../../../main/tailwind-to-css'

// ─── CLI 模式（本仓库独立调试时手动切换：取消注释下方块、注释上方 Electron 块）──
// import {
//   convertTailwindToLessRule,
//   generateLessContent,
//   convertTailwindToCSS,
//   type LessRule,
// } from '../../../lib/convertTailwindToCSS'

export { convertTailwindToLessRule, generateLessContent, convertTailwindToCSS }
export type { LessRule }
