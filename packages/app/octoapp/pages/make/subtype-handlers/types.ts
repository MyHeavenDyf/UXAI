import type { ResultTab } from "../components/result-viewer/tab-store"

export type FeatureType = 'localEdit' | 'drawEdit' | 'canvasEdit'

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
  
  beforeFeatureEnable?: (feature: FeatureType, ctx: SubtypeHandlerContext) => Promise<boolean>
}