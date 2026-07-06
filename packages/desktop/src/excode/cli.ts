#!/usr/bin/env node
/**
 * cli.ts — transformer CLI 独立调试入口
 *
 * 独立于 API 入口（index.ts），用于在不依赖 Electron/UXAI 的情况下
 * 进行 transformer 的本地开发调试。
 *
 * 从 pages-source/ 目录读取 A2UI JSON（HuiCodeInput 格式），
 * 调用 downloadHuiCode 获取文件列表后写入 output/ 目录。
 *
 * 用法:
 *   node cli.ts
 *   npm run dev
 *   node cli.ts --pages ./pages-source
 *   node cli.ts --pages ./custom-pages --output ./dist
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { downloadHuiCode } from './index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 解析命令行参数
 */
interface CliArgs {
  pages?: string;
  output?: string;
  config?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pages' && i + 1 < argv.length) args.pages = argv[++i];
    else if (argv[i] === '--output' && i + 1 < argv.length) args.output = argv[++i];
    else if (argv[i] === '--config' && i + 1 < argv.length) args.config = argv[++i];
  }
  return args;
}

/**
 * 从 pagesDir 读取 HuiCodeInput 数组
 */
function readPagesFromDir(pagesDir: string): Array<{ mergedA2UI: any; planner: any; _pageName?: string }> {
  const absDir = path.resolve(pagesDir);
  if (!fs.existsSync(absDir)) {
    throw new Error(`页面目录不存在: ${absDir}`);
  }

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const pageDirs = entries.filter(e => e.isDirectory()).map(e => path.join(absDir, e.name));

  return pageDirs
    .map(dir => {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      if (files.length === 0) {
        console.warn(`  ⚠  跳过 ${path.basename(dir)}: 无 JSON 文件`);
        return null;
      }
      const raw = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
      if (!raw.planner || !raw.mergedA2UI) {
        console.warn(`  ⚠  跳过 ${path.basename(dir)}: 缺少 planner/mergedA2UI`);
        return null;
      }
      raw._pageName = path.basename(dir);
      return raw;
    })
    .filter(Boolean) as Array<{ mergedA2UI: any; planner: any; _pageName?: string }>;
}

/**
 * 清空目录（删除重建）
 */
function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

async function main(): Promise<void> {
  const args = parseArgs();

  // 读取 config
  let config: Record<string, any> = {};
  if (args.config) {
    const customConfigPath = path.resolve(args.config);
    if (fs.existsSync(customConfigPath)) {
      config = JSON.parse(fs.readFileSync(customConfigPath, 'utf-8'));
    }
  } else {
    const defaultConfigPath = path.resolve(__dirname, 'config.json');
    if (fs.existsSync(defaultConfigPath)) {
      config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
    }
  }

  const pagesDir = args.pages || config.pagesDir || './pages-source';
  const outputDir = args.output
    ? path.resolve(args.output)
    : path.resolve(config.outputDir || './output');

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    A2UI → React 代码生成器 (transformer)    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`目标库: ${config.targetLib || 'eview-react'}`);
  console.log(`页面源: ${path.resolve(pagesDir)}`);
  console.log(`输出目录: ${outputDir}`);
  console.log('');

  // 读取页面数据
  const input = readPagesFromDir(pagesDir);
  if (input.length === 0) {
    console.error('  ✘  未找到有效页面，请检查 pages-source 目录结构');
    process.exit(1);
  }
  console.log(`  ℹ  读取到 ${input.length} 个页面`);
  console.log('');

  // 执行转换，只拿文件列表
  const { files } = await downloadHuiCode(input, {
    targetLib: config.targetLib,
  });

  // 写入磁盘前先清空输出目录
  cleanDir(outputDir);
  for (const file of files) {
    const filePath = path.join(outputDir, file.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, 'utf-8');
  }

  console.log(`\n✓ 已写入 ${files.length} 个文件到 ${outputDir}`);
}

main().catch(err => {
  console.error('\n✘ 管线执行失败:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
});