/**
 * transformer — A2UI JSON-to-React 管线 API 入口（新架构）
 *
 * 对外暴露 downloadHuiCode() 函数，供 Electron 项目调用。
 * 调用方式与原有 api/index.ts 一致。
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

import { ComponentRegistry } from './src/core/componentRegistry'
import { Pipeline } from './src/pipeline/pipeline'
import { PipelineContext } from './src/pipeline/pipelineContext'

// 步骤
import { RegisterComponents } from './src/steps/registerComponents'
import { BuildTrees } from './src/steps/buildTrees'
import { NodeMapper } from './src/steps/nodeMapper'
import { GenerateStyles } from './src/steps/generateStyles'
import { FileGenerator } from './src/steps/fileGenerator'
import { GenerateRoutes } from './src/steps/generateRoutes'
import { WriteOutput } from './src/steps/writeOutput'
import { GenerateReport } from './src/steps/generateReport'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 单页输入（标准形态）。
 * caller 负责装载并规范化；只需要 planner + mergedA2UI 两个字段。
 * pageName 由内部从 mergedA2UI.rootId 取出，不需要 caller 额外标记。
 */
export interface HuiCodeInput {
  planner: Record<string, unknown>
  mergedA2UI: Record<string, unknown>
}

/**
 * API 选项 —— 只含跨调用方确有意义的字段。
 * templateDir / pagesDir / outputDir / preserveOutput / steps / id / css 等工程内部配置，
 * 全部走 index.ts 内 config 对象，调用方无需感知。
 */
export interface HuiCodeOptions {
  /** 目标组件库，默认 eview-react */
  targetLib?: string
  /** 模板目录（绝对路径直接用，相对路径相对 api/ 解析）；默认 ./templates。
   *  Electron 打包时传 process.resourcesPath/hui-templates（绝对）。 */
  templateDir?: string
}

export interface OutputFile {
  path: string
  content: string
}

export interface DownloadHuiCodeResult {
  files: OutputFile[]
}

// ─── 内部 config 对象 ───
// 跨调用方不感知；不走 options 也不走 ESM import。
// templateDir 在 downloadHuiCode 内按 options 解析（见 resolveTemplateDir）。
const config: {
  templateDir: string
  /** 目标组件库 */
  targetLib: string
  /** CSS 模块化策略：true=每文件 *.module.less；false=全局 *.less */
  css: boolean
  /** 是否在产物 JSX 标签上输出 id 属性 */
  id: boolean
} = {
  templateDir: './templates',
  targetLib: 'eview-react',
  css: true,
  id: false,
}

/**
 * 解析模板目录（与旧 excode 用法一致）：
 *   - options.templateDir 提供 → 绝对路径直接用，相对路径相对 __dirname 解析
 *   - 未提供 → 默认 './templates'（相对 __dirname）
 *   - 解析后目录不存在 → 回退到 monorepo 源路径 '../../src/excode/templates'
 *   - 末尾拼接 targetLib 子目录（templates 按库名拆分：templates/{lib}/）
 *
 * Electron 打包时 IPC 传 process.resourcesPath/hui-templates（绝对路径），直接采用；
 * 该绝对路径下也需含 {lib} 子目录（eview-react / eview-ui）。
 */
function resolveTemplateDir(dir?: string, targetLib?: string): string {
  const lib = targetLib || 'eview-react'
  const base = dir && dir.trim() ? dir : './templates'
  const resolved = path.isAbsolute(base) ? base : path.resolve(__dirname, base)
  const libDir = path.join(resolved, lib)
  if (fs.existsSync(libDir)) return libDir
  // electron-vite 构建后 ./templates 不会自动复制到 out/main/，回退到 monorepo 源路径。
  const fallback = path.resolve(__dirname, '../../src/excode/templates')
  const fallbackLib = path.join(fallback, lib)
  if (fs.existsSync(fallbackLib)) return fallbackLib
  return libDir
}

/**
 * 默认步骤链（新架构）
 * 按顺序激活各步骤
 */
const DEFAULT_STEPS = [
  'RegisterComponents',
  'BuildTrees',
  'NodeMapper',
  'GenerateStyles',
  'FileGenerator',
  'GenerateRoutes',
  'GenerateReport',
  'WriteOutput',
]

const STEP_MAP: Record<string, any> = {
  RegisterComponents,
  BuildTrees,
  NodeMapper,
  GenerateStyles,
  FileGenerator,
  GenerateRoutes,
  GenerateReport,
  WriteOutput,
}

async function runPipeline(ctx: PipelineContext, steps: string[]): Promise<void> {
  const pipeline = new Pipeline()
  for (const stepName of steps) {
    const StepClass = STEP_MAP[stepName]
    if (!StepClass) {
      console.warn(`  [warn] 未知步骤: ${stepName}，跳过`)
      continue
    }
    pipeline.add(StepClass)
  }
  await pipeline.run(ctx)
}

/**
 * 将 A2UI 页面数据转换为 React 项目代码文件列表
 *
 * @param input - 标准化页面输入数组（CLI / Electron 应自行装载并规范化）
 * @param options - API 选项，仅含 targetLib
 * @returns 文件列表
 */
export async function downloadHuiCode(
  input: HuiCodeInput[],
  options: HuiCodeOptions = {}
): Promise<DownloadHuiCodeResult> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('[downloadHuiCode] input 必须为非空数组')
  }

  // ── 合并 config + options ──
  config.targetLib = options.targetLib ?? 'eview-react'
  // 模板目录按 options 解析（绝对路径直接用；默认 ./templates/{lib}；不存在回退源路径/{lib}）
  config.templateDir = resolveTemplateDir(options.templateDir, config.targetLib)

  const registry = new ComponentRegistry()
  const ctx = new PipelineContext(config, registry)

  // ── input → pagesData 形态直接注入 ctx，跳过 ReadPages ──
  ctx.pagesData = input.map((item, index) => {
    const mergedA2UI = item.mergedA2UI ?? {}
    const planner = item.planner ?? {}

    const elements = mergedA2UI.elements
    if (!mergedA2UI.rootId) {
      throw new Error(`[downloadHuiCode] input[${index}] mergedA2UI 缺少 rootId`)
    }
    if (!Array.isArray(elements)) {
      throw new Error(`[downloadHuiCode] input[${index}] mergedA2UI 缺少 elements`)
    }

    const slots = planner.slots
    const splitMeta = Array.isArray(slots)
      ? slots.map((slot: any) => ({
          id_prefix: slot.id_prefix || '',
          section_id: slot.section_id || '',
          element_id: slot.element_id || slot.id || '',
        }))
      : []

    // pageName 直接取 mergedA2UI.rootId（caller 不需要任何额外字段）
    const pageName = mergedA2UI.rootId

    return {
      pageName,
      a2uiDoc: {
        state: mergedA2UI.state || {},
        rootId: mergedA2UI.rootId,
        elements,
      },
      splitMeta,
    }
  })

  await runPipeline(ctx, DEFAULT_STEPS)

  return { files: ctx.outputFiles }
}
