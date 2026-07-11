/**
 * transformer — A2UI JSON-to-React 管线 API 入口
 *
 * 对外暴露 downloadHuiCode() 函数，供 Electron 项目调用。
 * CLI 调试入口请使用 cli.js（独立于 API 入口）。
 *
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { ComponentRegistry } from './src/core/ComponentRegistry';
import { Pipeline } from './src/pipeline/Pipeline';
import { PipelineContext } from './src/pipeline/PipelineContext';

// 步骤
import { RegisterComponents } from './src/steps/RegisterComponents';
import { ReadPages } from './src/steps/ReadPages';
import { BuildTrees } from './src/steps/BuildTrees';
import { ResolveIcons } from './src/steps/ResolveIcons';
import { GenerateComponents } from './src/steps/GenerateComponents';
import { GenerateRoutes } from './src/steps/GenerateRoutes';
import { WriteOutput } from './src/steps/WriteOutput';
import { GenerateReport } from './src/steps/GenerateReport';

// 默认配置（ESM 模块导入，替代旧的 config.json 文件读取）
import defaultConfig from './config';

// ─── 工具函数 ───

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface OutputFile {
  path: string;
  content: string;
}

interface DownloadHuiCodeResult {
  files: OutputFile[];
}

/**
 * 获取默认配置
 */
function getDefaultConfig(): Record<string, any> {
  return { ...defaultConfig };
}

/**
 * 默认步骤链
 */
const DEFAULT_STEPS = [
  'RegisterComponents',
  'ReadPages',
  'BuildTrees',
  'ResolveIcons',
  'GenerateComponents',
  'GenerateRoutes',
  'WriteOutput',
  'GenerateReport',
];

const STEP_MAP: Record<string, any> = {
  RegisterComponents,
  ReadPages,
  BuildTrees,
  ResolveIcons,
  GenerateComponents,
  GenerateRoutes,
  WriteOutput,
  GenerateReport,
};

/**
 * 构建并运行管线
 */
async function runPipeline(ctx: any, steps: string[]): Promise<void> {
  const pipeline = new Pipeline();
  for (const stepName of steps) {
    const StepClass = STEP_MAP[stepName];
    if (!StepClass) {
      console.warn(`  [warn] 未知步骤: ${stepName}，跳过`);
      continue;
    }
    pipeline.add(StepClass);
  }
  await pipeline.run(ctx);
}

// ═══════════════════════════════════════════
//  对外 API
// ═══════════════════════════════════════════

/**
 * 将 A2UI 页面数据转换为 React 项目代码文件列表
 *
 * @param input - HuiCodeInput 数组
 *   mergedA2UI = { rootId, elements, state }  — A2UI 页面描述
 *   planner    = { rootId, elements, slots }   — 布局规划
 * @param options - 可选配置
 * @returns files 数组可直接传给 desktopApi.exportZip({ defaultName, files })
 */
export async function downloadHuiCode(
  input: Array<{ mergedA2UI: any; planner: any }>,
  options: Record<string, any> = {}
): Promise<DownloadHuiCodeResult> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('[downloadHuiCode] input 必须为非空数组');
  }

  // 1. 加载配置（合并默认配置和传入的 options）
  const config: Record<string, any> = { ...getDefaultConfig(), ...options };
  delete config.outputDir; // 绝不在此函数内写磁盘

  // 将模板路径转绝对路径
  if (config.templateDir && !path.isAbsolute(config.templateDir)) {
    config.templateDir = path.resolve(__dirname, config.templateDir);
  } else if (!config.templateDir) {
    config.templateDir = path.resolve(__dirname, './templates');
  }

  // electron-vite 构建后 ./templates 不存在（不会自动复制到 out/main/），
  // 回退到 monorepo 源路径读取模板。模板最终会被 desktopApi.exportZip 打成 zip。
  if (!fs.existsSync(config.templateDir)) {
    const fallback = path.resolve(__dirname, '../../src/excode/templates');
    if (fs.existsSync(fallback)) {
      config.templateDir = fallback;
    }
  }

  // 2. 创建注册器与上下文
  const registry = new ComponentRegistry();
  const ctx = new PipelineContext(config, registry, input);

  // 3. 执行管线
  await runPipeline(ctx, DEFAULT_STEPS);

  // 4. 只返回文件列表，不做任何 IO
  return { files: ctx.outputFiles };
}

export type HuiCodeInput = {
  planner: Record<string, unknown>
  mergedA2UI: Record<string, unknown>
}