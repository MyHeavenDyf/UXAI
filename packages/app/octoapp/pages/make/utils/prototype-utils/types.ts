import type { SubtypeHandlerContext } from "../../subtype-handlers/types"

export type PrototypeSession = {
  tabId: string
  editing: boolean
  ctx: SubtypeHandlerContext
  messageHandler: ((e: MessageEvent) => void) | null
  a2ui: { doc: unknown; loadSize: number | null } | null
  persistTimer: ReturnType<typeof setTimeout> | null
  persistFilePath: string | null
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
}

export type PrototypeQuickFixData = {
  elementId: string
  componentType: string
  currentClass: string
  elementProps: string
  elementRect: { top: number; left: number; width: number; height: number }
}

export type PrototypeModifyData = {
  elementId: string
  className: string
  textContent: string
  componentProps: Record<string, string | boolean>
  tag?: string
  keepOpen?: boolean
  saveToHistory?: boolean
}
