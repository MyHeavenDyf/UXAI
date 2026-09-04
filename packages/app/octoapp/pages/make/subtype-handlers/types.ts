import type { ResultTab } from "../components/result-viewer/tab-store"
import type { ManualEditTarget } from "../edit-mode/source-patches"
import type { VersionFile } from "../utils/history-store"
import type { JSX } from "solid-js"
import type { UploadZipOptions, UsePixsoTransportResult } from "@/utils/useZipTransport"

export type FeatureType = 'localEdit' | 'drawEdit' | 'canvasEdit' | 'comment' | 'archive'

export type HistoryTriggerEvent =
  | { type: 'open'; isNew: boolean }
  | { type: 'edit' }
  | { type: 'agent-update' }
  | { type: 'agent-file-edit' }

export interface CanvasEditResult {
  handled: boolean
  options?: UploadZipOptions
}

export interface SubtypeHandlerContext {
  tab: ResultTab
  showOctoToast: (msg: { title: string; description?: string; variant?: "default" | "error" | "warn" }) => void
  tracker: typeof import("@/utils/tracker").tracker
  getDesktopApi: typeof import("../lib/electron-api").getDesktopApi
  extractCodeBlock: (text: string, lang: string) => string
  observedUrlsGetter?: () => string[]
  usePixsoTransport: (options: UploadZipOptions) => Promise<UsePixsoTransportResult>
  updateTabContent?: (id: string, content: string) => void
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
  sdkDirectory?: string
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

  handleCanvasEdit?: (ctx: SubtypeHandlerContext) => Promise<CanvasEditResult | boolean | void>

  handleLocalEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>
  
  handleLocalEditSave?: (ctx: SubtypeHandlerContext & { edit: LocalEditSavePayload }) => Promise<boolean | void>
  

  handleLocalEditDisable?: (ctx: SubtypeHandlerContext) => Promise<void>

  handleDrawEdit?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>

  handleComment?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>

  handleArchive?: (ctx: SubtypeHandlerContext) => Promise<boolean | void>

  /**
   * 处理下载
   * @param option 选中项的 value（来自 downloadOptions）；未声明 downloadOptions 时为 undefined
   * @returns true 表示已处理（不执行默认下载），false 或 void 表示执行默认下载
   */
  handleDownload?: (ctx: SubtypeHandlerContext, option?: string) => Promise<boolean | void>

  /**
   * 构建归档时要塞进 src/ 的代码包
   * 返回 { blob, fileName } 表示要写入 src/<fileName>；
   * 返回 null 表示该 subtype 不提供 src 内容（默认行为，src/ 留空）
   */
  buildArchiveSrc?: (ctx: SubtypeHandlerContext) => Promise<{ files: { path: string; content: string | Uint8Array }[] } | null>

  /**
   * 下载下拉选项
   * 声明且长度 > 1 时，action bar 渲染"下载"下拉按钮；每项 value 会作为 option 传给 handleDownload
   */
  downloadOptions?: { value: string; label: string }[]

  beforeFeatureEnable?: (feature: FeatureType, ctx: SubtypeHandlerContext) => Promise<boolean>

  /**
   * 历史记录触发点
   * 在 open/edit/agent-update/agent-file-edit 事件发生时调用
   * 返回要记录的文件相对路径数组，或 null 表示本次不记录
   * actor（init/user/agent）由调用方根据事件类型决定
   */
  onHistoryTrigger?: (event: HistoryTriggerEvent, ctx: SubtypeHandlerContext) => string[] | null

  /**
   * 历史恢复
   * 接收版本的文件列表，由 handler 决定如何应用（如复制回原始路径、更新 tab 等）
   */
  applyVersionFiles?: (ctx: SubtypeHandlerContext, files: VersionFile[]) => Promise<void>

  /**
   * UI 配置（配置方式）
   */
  components?: UIComponentsConfig

  /**
   * 完全自定义渲染（JSX方式）
   */
  renderUI?: (ctx: SubtypeHandlerContext) => JSX.Element
}

/**
 * UI 组件配置
 */
export interface UIComponentsConfig {
  actionBar?: ActionBarConfig
  sidePanel?: SidePanelConfig
  overlays?: OverlayConfig[]
}

/**
 * Action Bar 配置
 */
export interface ActionBarConfig {
  /** 额外的按钮（追加到现有按钮后） */
  extraButtons?: ActionBarButton[]
  
  /** 自定义按钮（替换默认按钮） */
  customButtons?: ActionBarButton[]
  
  /** 是否替换默认按钮 */
  replaceDefaultButtons?: boolean
}

/**
 * Action Bar 按钮位置
 */
export type ButtonPosition = 
  | 'start'              // 最前面（左侧区域开始）
  | 'after-refresh'      // 刷新按钮之后
  | 'after-mode-toggle'  // 预览/源码切换之后
  | 'after-viewport'     // 视口选择器之后
  | 'after-edit'         // 编辑按钮（局部修改、框选、画布）之后
  | 'after-download'     // 下载按钮之后
  | 'after-archive'      // 归档按钮之后
  | 'before-comment'     // 标注按钮之前
  | 'before-history'     // 历史按钮之前
  | 'before-fullscreen'  // 全屏按钮之前
  | 'end'                // 最后面（默认）

/**
 * Action Bar 按钮
 */
export interface ActionBarButton {
  id: string
  label: string | ((ctx: SubtypeHandlerContext) => string)
  icon?: JSX.Element | string | ((ctx: SubtypeHandlerContext) => JSX.Element | string)
  
  /** 按钮位置（默认 'end'） */
  position?: ButtonPosition
  
  /** 同位置按钮的排序（数字越小越靠前） */
  order?: number
  
  onClick?: (ctx: SubtypeHandlerContext) => void | Promise<void>
  disabled?: boolean | ((ctx: SubtypeHandlerContext) => boolean)
  visible?: boolean | ((ctx: SubtypeHandlerContext) => boolean)
  active?: boolean | ((ctx: SubtypeHandlerContext) => boolean)
  tooltip?: string | ((ctx: SubtypeHandlerContext) => string)
  variant?: 'default' | 'primary' | 'danger'
}

/**
 * Side Panel 配置
 */
export interface SidePanelConfig {
  /** 面板组件ID或渲染函数 */
  component: string | ((props: SidePanelProps) => JSX.Element)
  
  /** 面板位置 */
  position?: 'left' | 'right'
  
  /** 面板宽度 */
  width?: number | string
  
  /** 是否可调整大小 */
  resizable?: boolean
  
  /** 最小宽度 */
  minWidth?: number
  
  /** 最大宽度 */
  maxWidth?: number
  
  /** 标题 */
  title?: string
}

/**
 * Side Panel Props
 */
export interface SidePanelProps {
  tab: ResultTab
  open: boolean
  onClose: () => void
  ctx: SubtypeHandlerContext
}

/**
 * Overlay 配置
 */
export interface OverlayConfig {
  /** Overlay 组件ID或渲染函数 */
  component: string | ((props: OverlayProps) => JSX.Element)
  
  /** 层级 */
  zIndex?: number
  
  /** 是否拦截事件 */
  pointerEvents?: boolean
}

/**
 * Overlay Props
 */
export interface OverlayProps {
  tab: ResultTab
  ctx: SubtypeHandlerContext
}
