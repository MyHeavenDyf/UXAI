/**
 * PipelineContext — 管线上下文
 *
 * 保存管线执行过程中所有步骤共享的数据。
 * 各步骤按顺序读写 ctx 上的字段，不存在页面循环概念（页面级数据一步处理全部）。
 *
 * === 生命周期 ===
 *
 * Pipeline.run() 创建 → 步骤链依次 execute(ctx) → 结束后 discard
 *
 * === 核心字段 ===
 *
 * config             配置对象
 * registry           ComponentRegistry 实例
 * targetLib          目标组件库名（如 "eview-react"）
 * tailwindAdapter    样式转换适配器实例（{ convert } 接口），由 src/tailwind/ 工厂创建
 *
 * === 数据流字段（按步骤写入）===
 *
 * pagesData[]        ← 步骤 01: 原始页面数据
 * resolvedPages[]    ← 步骤 02: 构建树 + 绑定解析结果
 * styleResults[]     ← 步骤 02: 样式转换结果
 * iconNameMap        ← 步骤 03: ResolveIcons 收集的 icon 名称映射表
 *                      A2UI icon name → @hui/icon-plus 组件名
 *                      如 { menu: 'IconPlusIcIctMenu', home: 'IconPlusIcIctHome' }
 * generatedPages[]   ← 步骤 05: 代码生成结果
 * routeResult        ← 步骤 06: 路由文件
 * outputFiles        ← 步骤 07: 最终的输出文件清单
 */
import type { ComponentRegistry } from '../core/ComponentRegistry';

export class PipelineContext {
  config: Record<string, any>;
  registry: ComponentRegistry;
  targetLib: string;
  tailwindAdapter: any;
  pagesSourceData: any;
  pagesData: any[];
  resolvedPages: any[];
  styleResults: any[];
  /**
   * icon 名称映射表（A2UI name → @hui/icon-plus 组件名）
   * 由 ResolveIcons 步骤填充，供 Icon.ts 等 mapping transform 查询
   */
  iconNameMap: Record<string, string>;
  generatedPages: any[];
  routeResult: any;
  outputFiles: any[];
  generationReport?: string;

  /**
   * @param config - 配置对象
   * @param registry - ComponentRegistry 实例
   * @param pagesSourceData - API 传入的内存数据（HuiCodeInput 格式）
   */
  constructor(config: Record<string, any>, registry: ComponentRegistry, pagesSourceData: any = null) {
    this.config = config;
    this.registry = registry;
    this.targetLib = config.targetLib || 'eview-react';
    this.tailwindAdapter = config.tailwindAdapter || null;

    // API 模式：直接从内存传入的数据（ReadPages 会优先使用）
    this.pagesSourceData = pagesSourceData;

    // 步骤 00：RegisterComponents 直接使用 ctx.registry
    // 步骤 01：ReadPages
    this.pagesData = [];
    // 步骤 02：BuildTrees（绑定解析 + 样式转换合并于此）
    this.resolvedPages = [];
    this.styleResults = [];
    // 步骤 05：GenerateComponents
    this.generatedPages = [];
    // 步骤 06：GenerateRoutes
    this.routeResult = null;
    // 步骤 07：WriteOutput
    this.outputFiles = [];
    // 步骤 03：ResolveIcons（在 GenerateComponents 之前）
    this.iconNameMap = {};
  }
}