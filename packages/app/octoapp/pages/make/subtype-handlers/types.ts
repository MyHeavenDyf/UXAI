import type { ResultTab } from "../components/result-viewer/tab-store"
import type { ManualEditTarget } from "../edit-mode/source-patches"

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

export type LocalEditChange =
  | { kind: 'text'; before: string; after: string }
  | { kind: 'href'; before: string; after: string }
  | { kind: 'styles'; changes: Array<{ prop: string; before: string; after: string }> }
  | { kind: 'remove-element' }
  | { kind: 'image'; src: string; alt: string }

export interface LocalEditSavePayload {
  target: ManualEditTarget
  changes: LocalEditChange[]
}

export interface SubtypeHandler {
  name: string
  
  handleCanvasEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleLocalEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleLocalEditSave?: (ctx: SubtypeHandlerContext & { edit: LocalEditSavePayload }) => Promise<boolean | void>
  
  handleDrawEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleComment?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleArchive?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  beforeFeatureEnable?: (feature: FeatureType, ctx: SubtypeHandlerContext) => Promise<boolean>
}