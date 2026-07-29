/**
 * PipelineContext — 管线上下文
 *
 * 保存管线执行过程中所有步骤共享的数据。
 * 各步骤按顺序读写 ctx 上的字段。
 *
 * === 数据流字段（按步骤写入） ===
 *
 * registry           Step 0: 创建时注入
 * config             配置对象
 * targetLib          目标组件库名
 *
 * pagesData           Step 1: 读 A2UI 数据
 * builtPages          Step 2: BuildTrees 产出
 * iconNameMap         icon API 映射结果
 * mappedPages         Step 3: NodeMapper 产出
 * generatedFiles      Step 4: FileGenerator 产出
 * routeResult         Step 5: 路由文件
 * outputFiles         Step 6: 最终输出文件清单
 * generationReport    Step 7: 报告
 */

import type { ComponentRegistry } from '../core/componentRegistry'
import type { BuildNode, ExtractNode } from '../core/nodeTypes'

export interface BuiltPage {
  pageName: string
  state: Record<string, any>
  rootTree: BuildNode
  extracts: ExtractNode[]   // ExtractNode 索引视图
  iconNameSet: string[]
  iconNameMap: Record<string, string>  // A2UI name → @nce/icon-plus 组件名
}

export interface MappedPage {
  pageName: string
  state: Record<string, any>
  rootTree: BuildNode
  extracts: ExtractNode[]     // NodeMapper 已 walkTree body 子节点
  iconNameMap: Record<string, string>
}

export interface GeneratedFile {
  path: string
  content: string
}

export class PipelineContext {
  // ── 基础 ──
  config: Record<string, any>
  registry: ComponentRegistry
  targetLib: string

  // ── Step 2: ReadPages ──
  pagesData: any[]

  // ── Step 3: BuildTrees ──
  builtPages: BuiltPage[]
  iconNameMap: Record<string, string>

  // ── Step 4: NodeMapper ──
  mappedPages: any[]

  // ── Step 5: FileGenerator ──
  generatedFiles: GeneratedFile[]

  // ── Step 5b: GenerateStyles（less / module.less）──
  styleResults: any[]

  // ── Step 6: GenerateRoutes ──
  routeResult: any

  // ── Step 7: WriteOutput ──
  outputFiles: GeneratedFile[]

  // ── Step 8: GenerateReport ──
  generationReport?: string

  constructor(config: Record<string, any>, registry: ComponentRegistry) {
    this.config = config
    this.registry = registry
    this.targetLib = config.targetLib || 'eview-react'

    this.pagesData = []
    this.builtPages = []
    this.iconNameMap = {}
    this.mappedPages = []
    this.generatedFiles = []
    this.styleResults = []
    this.routeResult = null
    this.outputFiles = []
  }
}
