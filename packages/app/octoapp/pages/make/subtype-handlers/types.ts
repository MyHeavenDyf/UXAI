import type { ResultTab } from "../components/result-viewer/tab-store"

export type FeatureType = 'localEdit' | 'drawEdit' | 'canvasEdit' | 'comment' | 'archive'

export interface SubtypeHandlerContext {
  tab: ResultTab
  showToast: (msg: { title: string; description?: string; variant?: "default" | "error" }) => void
  tracker: typeof import("@/utils/tracker").tracker
  getDesktopApi: typeof import("../lib/electron-api").getDesktopApi
  extractCodeBlock: (text: string, lang: string) => string
  observedUrlsGetter?: () => string[]
  projectSelection: () => unknown
}

export interface SubtypeHandler {
  name: string
  
  handleCanvasEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleLocalEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleDrawEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleComment?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleArchive?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  /**
   * 处理下载
   * @returns true 表示已处理（不执行默认下载），false 或 void 表示执行默认下载
   */
  handleDownload?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  beforeFeatureEnable?: (feature: FeatureType, ctx: SubtypeHandlerContext) => Promise<boolean>
}