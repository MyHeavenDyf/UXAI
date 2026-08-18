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

import type { ComponentRegistry } from '../core/component-registry'
import type { BuildNode, ExtractNode } from '../core/node-types'

export interface BuiltPage {
  pageName: string
  state: Record<string, any>
  rootTree: BuildNode
  extracts: ExtractNode[]   // ExtractNode 索引视图
  iconNameSet: string[]
  iconNameMap: Record<string, string>  // A2UI name → @nce/icon-plus 组件名
  /** 事件 Action 改写的 state path 集合（带前导 `/`，与 binding.path 对齐）；state-builder 据此打 shared 标记 */
  eventMutatedPaths: Set<string>
}

export interface MappedPage {
  pageName: string
  state: Record<string, any>
  rootTree: BuildNode
  extracts: ExtractNode[]     // NodeMapper 已 walkTree body 子节点
  iconNameMap: Record<string, string>
  /** 事件 Action 改写的 state path 集合（来自 BuiltPage，state-builder 据此打 shared 标记） */
  eventMutatedPaths: Set<string>
}

export interface GeneratedFile {
  path: string
  content: string
}

/** 管线执行期错误（单页隔离收集，由 GenerateReport 汇总输出） */
export interface PipelineError {
  /** 出错步骤名（BuildTrees / NodeMapper / FileGenerator） */
  step: string
  /** 出错页名 */
  page: string
  /** 错误信息 */
  message: string
  /** 可选堆栈 */
  stack?: string
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

  // ── 执行期诊断（非数据流）──
  /** 当前正处理的页名；per-page step 在循环里设置，pipeline-engine catch 时读取以定位失败页面 */
  currentPage?: string
  /** 单页隔离收集的错误清单；per-page step 的 try/catch push，GenerateReport 汇总输出 */
  errors: PipelineError[]

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
    this.errors = []
  }
}
