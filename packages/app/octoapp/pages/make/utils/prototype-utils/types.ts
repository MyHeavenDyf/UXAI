import type { SubtypeHandlerContext } from "../../subtype-handlers/types"

export type A2uiDocEntry = {
  doc: unknown
  loadSize: number | null
  /** 裸 JSON 持久化目标（绝对路径）；旧单 data.js 页即 data.js 本身 */
  jsonPath: string
  /** file:// 孪生 .data.js（绝对路径），无孪生则 null */
  dataJsPath: string | null
  /** 实例标识 = doc.rootId，用于 od:a2ui-update / state-snapshot 路由 */
  rootId: string
  persistTimer: ReturnType<typeof setTimeout> | null
  persistPending: boolean
}

export type PrototypeSession = {
  tabId: string
  editing: boolean
  ctx: SubtypeHandlerContext
  messageHandler: ((e: MessageEvent) => void) | null
  /** 混合页可有多个 A2UI 数据文件（a2ui-data/*），每个一条；旧全 A2UI 页为单条 data.js entry */
  a2uiDocs: A2uiDocEntry[]
}

export type PrototypeEditTarget = {
  elementId: string
  tagName: string
  className: string
  text: string
  rect: { top: number; left: number; width: number; height: number }
  styles: Record<string, string>
  outerHtml: string
}

export type PrototypeCtxMenuData = {
  x: number
  y: number
  id: string
  tagName: string
  /** 'host' = 宿主页面元素（非 A2UI），缺省视为 'a2ui' */
  kind?: 'a2ui' | 'host'
  /** 宿主元素的 CSS 选择器（kind='host' 时有值），复制名称时用 */
  selector?: string
}

export type PrototypeQuickFixData = {
  elementId: string
  componentType: string
  currentClass: string
  elementProps: string
  elementRect: { top: number; left: number; width: number; height: number }
  /** prototype.html 绝对路径，供属性编辑器把上传图片写到同级 uploads/ */
  filePath?: string
  /** 'host' = 宿主页面元素（非 A2UI），缺省视为 'a2ui' */
  kind?: 'a2ui' | 'host'
  /** 宿主元素的 CSS 选择器（kind='host' 时有值）；host 下 elementId 即此选择器 */
  selector?: string
}

/** 选中元素尺寸/位置变化时由 iframe ResizeObserver 回传，让父侧 mask 蓝框跟随更新。 */
export type PrototypeRectUpdateData = {
  elementId: string
  elementRect: { top: number; left: number; width: number; height: number }
}

export type PrototypeModifyData = {
  elementId: string
  className: string
  textContent: string
  componentProps: Record<string, string | boolean | object>
  tag?: string
  keepOpen?: boolean
  saveToHistory?: boolean
}
