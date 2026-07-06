/**
 * config.ts — 管线默认配置（ESM 模块）
 *
 * 通过 ESM import 加载。
 * 配置项可通过 downloadHuiCode() 的 options 参数覆盖。
 */
export interface TransformerConfig {
  pagesDir: string;
  outputDir: string;
  templateDir: string;
  preserveOutput: boolean;
  steps: string[];
  targetLib?: string;
  tailwindAdapter?: any;
}

const defaultConfig: TransformerConfig = {
  pagesDir: './pages-source',
  outputDir: './output',
  templateDir: './templates',
  preserveOutput: false,
  steps: [
    'RegisterComponents',
    'ReadPages',
    'BuildTrees',
    'GenerateComponents',
    'GenerateRoutes',
    'WriteOutput',
    'GenerateReport',
  ],
};

export default defaultConfig;