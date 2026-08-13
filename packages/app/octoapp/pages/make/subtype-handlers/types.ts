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
  postMessageToIframe?: (data: unknown) => void
  iframeElementGetter?: () => HTMLIFrameElement | undefined
  /** SDK 客户端实例（供 proto_replanner 使用） */
  sdk?: { client: any; directory: string; url: string }
  /** 当前模型 key（供 proto_replanner 使用） */
  modelKey?: { providerID: string; modelID: string }
  /** 同步对象（供 proto_replanner 的 runChildSession 使用） */
  sync?: any
  /** 当前会话 ID（用于定位 uploads 目录） */
  sessionId?: string
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