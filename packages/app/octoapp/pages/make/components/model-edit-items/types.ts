import type { ManualEditKind, ManualEditPatch } from "../../edit-mode/source-patches"
import type { ColorToken } from "../../../pattern/modules/preview/property-editor-popup/hui-color-tokens"
import type { AssetFile } from "../../components/addon-menu/asset-library"

export type { ManualEditKind }

export type SelectionKind = "component" | "native"

export type ModelEditElement = {
  dataOdId: string
  tagName: string
  className: string
  attributes: Record<string, string>
  styles: Record<string, string>
  outerHTML: string
  rect: { x: number; y: number; width: number; height: number }
  text: string
  selector: string
  htmlHint: string
  isLayoutContainer: boolean
  elementKind: ManualEditKind
  selectionKind: SelectionKind
  componentType?: string
  htmlType?: string
}

export type InputItemData = {
  title: string
  default: string
  placeholder: string
}

export type SelectorItemData = {
  title: string
  items: { value: string; label: string }[]
  default: string
}

export type ComponentItemConfig =
  | { type: "input"; key: string; data: InputItemData }
  | { type: "selector"; key: string; data: SelectorItemData }

export type NativeItemConfig = {
  type: string
  key: string
}

export type ConfigItem = ComponentItemConfig | NativeItemConfig

export type ConfigGroup = {
  title?: string
  items: ConfigItem[]
}

export type ComponentTypeConfig = {
  title: string
  info?: (dom: ModelEditElement) => string
  config: ConfigGroup[]
  data: (dom: ModelEditElement) => Record<string, string>
}

export type HtmlTypeConfig = {
  config: (defaultConfig: ConfigGroup[]) => ConfigGroup[]
  data: (defaultData: Record<string, string>, dom: ModelEditElement) => Record<string, string>
}

export type ModelEditContext = {
  dom: ModelEditElement
  filePath: string
  type: string
  postMessageToIframe: (data: unknown) => void
  getIframeSnapshot: () => Promise<string>
  onContentChange: (content: string) => Promise<void>
  onRefreshNeeded: () => void
  cleanBridgeContent: (html: string) => string
  applyPatch: (html: string, patch: ManualEditPatch) => { ok: boolean; source: string; error?: string }
  wrapHtmlContent: (html: string) => string
  /** 由 customContext 工厂注入的 subtype 特有上下文 */
  custom: Record<string, unknown>
}

/**
 * 编辑模式级 Context：在 model edit 模式开/关及 bridge 消息回调中可用。
 * 与 ModelEditContext（绑定具体选中元素）不同，它在进入编辑模式时即存在。
 */
export type ModelEditModeContext = {
  postMessageToIframe: (data: unknown) => void
  getIframeSnapshot: () => Promise<string>
  onContentChange: (content: string) => Promise<void>
  onRefreshNeeded: () => void
  /** 由 customContext 工厂注入的 subtype 特有上下文 */
  custom: Record<string, unknown>
}

export type OnChangeArgs = ModelEditContext & {
  key: string
  value: any
  prev: any
}

export type SaveCallbackArgs = ModelEditContext & {
  prev: Record<string, any>
  current: Record<string, any>
}

export type DeleteCallbackArgs = ModelEditContext

export type IconState = {
  name?: string
  id?: string
  isCustom?: boolean
  size?: string
  style?: string
  color?: string
  url?: string
  src?: string
  svgContent?: string
}

export type IconConfirmArgs = {
  prev: IconState
  current: IconState
  dom: ModelEditElement
  filePath: string
  postMessageToIframe: (data: unknown) => void
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  sessionDir?: string
  getIframeSnapshot?: () => Promise<string>
  cleanBridgeContent?: (html: string) => string
  wrapHtmlContent?: (html: string) => string
  onContentChange?: (content: string) => Promise<void>
  onRefreshNeeded?: () => void
}

export type IconConfig = {
  getCustomIconDir?: (ctx: { sessionDir: string; filePath: string }) => string
  getInitialState?: (dom: ModelEditElement) => IconState
  data?: {
    styles?: { key: string; label: string; value: string }[]
    colors?: Record<string, { label: string; color: string; twoColor: string; threeColor: string }>
    sizes?: string[]
    acceptedFileTypes?: string
  }
  onlineServiceUrl?: string
  onConfirm: (args: IconConfirmArgs) => string | Promise<string>
}

export type SelectionStyle = {
  color?: string
  width?: number
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
  offset?: number
}

export type ModelEditConfig = {
  componentFlag?: string
  componentConfig?: Record<string, ComponentTypeConfig>
  htmlFlag?: string
  htmlConfig?: Record<string, HtmlTypeConfig>
  saveCallback: (args: SaveCallbackArgs) => string | Promise<string>
  deleteCallback: (args: DeleteCallbackArgs) => string | Promise<string>
  promptCallback?: (filePath: string, selector: string) => string
  colors?: ColorToken[]
  onChange?: (args: OnChangeArgs) => void
  iconConfig?: IconConfig
  assetConfig?: AssetConfig
  selectionStyle?: (dom: ModelEditElement) => SelectionStyle | null | undefined
  /** 进入 model edit 模式时调用（按钮开启）。用于初始化自定义编辑态 */
  onEnter?: (ctx: ModelEditModeContext) => void | Promise<void>
  /** 退出 model edit 模式时调用（按钮关闭）。用于清理（如 dispose session、保存未提交状态） */
  onExit?: (ctx: ModelEditModeContext) => void | Promise<void>
  /** 工厂函数：注入 subtype 特有上下文，合并进 ModelEditContext.custom 与 ModelEditModeContext.custom */
  customContext?: () => Record<string, unknown>
  /**
   * 编辑模式激活期间，接收 iframe 发来的未被内置处理的消息（含 data.type）。
   * 覆盖拖拽排序（od:drag-reorder）、状态同步（A2UI_STATE_CHANGE）等自定义协议。
   */
  onBridgeMessage?: (data: unknown, ctx: ModelEditModeContext) => void
}

export type AssetState = {
  name?: string
  icon?: string
  id?: string
}

export type AssetConfirmArgs = {
  dom: ModelEditElement
  filePath: string
  folderpath: string
  data: AssetFile
}

export type AssetConfig = {
  showConfig?: (dom: ModelEditElement) => boolean
  getInitialState?: (dom: ModelEditElement) => AssetState
  onConfirm: (args: AssetConfirmArgs) => string | Promise<string>
}
