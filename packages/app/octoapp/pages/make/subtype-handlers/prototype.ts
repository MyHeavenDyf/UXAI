import type { SubtypeHandler } from './types'
import type { SubtypeHandlerContext } from './types'
import { getDesktopApi } from "../lib/electron-api"

let editing = false
let messageHandler: ((e: MessageEvent) => void) | null = null
let currentCtx: SubtypeHandlerContext | null = null

export function isPrototypeEditing() {
  return editing
}

export function resetPrototypeEditing() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    const fp = persistFilePath
    persistFilePath = null
    if (fp) void persistA2uiData(fp)
  }
  editing = false
  currentCtx = null
  if (messageHandler) {
    window.removeEventListener("message", messageHandler)
    messageHandler = null
  }
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

const PROTOTYPE_EDIT_EVENT = "prototype:edit-selected"

export function dispatchPrototypeEditTarget(target: PrototypeEditTarget) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_EDIT_EVENT, { detail: target }))
}

export function onPrototypeEditTarget(handler: (target: PrototypeEditTarget) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeEditTarget>).detail)
  window.addEventListener(PROTOTYPE_EDIT_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_EDIT_EVENT, listener)
}

export type PrototypeCtxMenuData = {
  x: number
  y: number
  id: string
  tagName: string
}

const PROTOTYPE_CTX_MENU_EVENT = "prototype:ctx-menu"

export function dispatchPrototypeCtxMenu(data: PrototypeCtxMenuData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_CTX_MENU_EVENT, { detail: data }))
}

export function onPrototypeCtxMenu(handler: (data: PrototypeCtxMenuData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeCtxMenuData>).detail)
  window.addEventListener(PROTOTYPE_CTX_MENU_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_CTX_MENU_EVENT, listener)
}

/** 向当前 prototype iframe 发送 postMessage（用于「选择父容器」等动作） */
export function sendToPrototypeIframe(data: unknown) {
  currentCtx?.postMessageToIframe?.(data)
}

type A2uiElement = { children?: unknown[] }
type A2uiDocument = { elements?: A2uiElement[] }

const a2uiCache = new Map<string, unknown>()

/** 从 A2UI 文档构建同层元素 siblingMap（用于 od:drag-mode 拖拽换序） */
function buildSiblingMap(data: unknown): Record<string, string[]> | undefined {
  const elements = (data as A2uiDocument | null)?.elements
  if (!Array.isArray(elements)) return undefined
  const map: Record<string, string[]> = {}
  for (const el of elements) {
    const kids = Array.isArray(el.children) ? el.children.filter((k): k is string => typeof k === "string") : []
    if (kids.length < 2) continue
    for (const kid of kids) map[kid] = kids
  }
  return Object.keys(map).length > 0 ? map : undefined
}

/** 读取与 prototype.html 同目录的 data.js（内联 window.__A2UI_DATA__），按 filePath 缓存。
 *  正则去掉前导 BOM/空白后再匹配赋值语句，兼容带注释/换行开头的文件。解析失败不缓存，下次重试。 */
async function loadA2uiData(ctx: SubtypeHandlerContext): Promise<unknown | null> {
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return null
  const cached = a2uiCache.get(filePath)
  if (cached !== undefined) return cached
  const dir = filePath.replace(/[\\/][^\\/]+$/, "")
  const buffer = await ctx.getDesktopApi()?.readFileBuffer?.(`${dir}/data.js`)
  if (!buffer) return null
  const text = new TextDecoder().decode(new Uint8Array(buffer))
  const stripped = text.replace(/^\uFEFF/, "").trimStart()
  const jsonStr = stripped.replace(/^window\.__A2UI_DATA__\s*=\s*/, "").replace(/;\s*$/, "")
  try {
    const data = JSON.parse(jsonStr)
    a2uiCache.set(filePath, data)
    return data
  } catch {
    return null
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistFilePath: string | null = null

/** 把缓存的 A2UI JSON 序列化回 data.js（window.__A2UI_DATA__ = ...）写盘，iframe 重载即生效。
 *  原子写：先写同目录临时文件再 rename 到目标，避免写到一半崩溃截断 data.js。
 *  无 renameFile API（旧桌面端）时回退到直接覆盖写。 */
async function persistA2uiData(filePath: string) {
  const data = a2uiCache.get(filePath)
  if (!data || typeof data !== "object") return
  const dir = filePath.replace(/[\\/][^\\/]+$/, "")
  const content = `window.__A2UI_DATA__ = ${JSON.stringify(data)};\n`
  const buffer = new TextEncoder().encode(content).buffer as ArrayBuffer
  const api = getDesktopApi()
  if (api?.renameFile) {
    const tmp = `${dir}/.data.js.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await api.writeFileBuffer?.(tmp, buffer)
    await api.renameFile(tmp, `${dir}/data.js`)
    return
  }
  await api?.writeFileBuffer?.(`${dir}/data.js`, buffer)
}

/** 防抖排程写盘（合并连续拖滑块等快速编辑） */
function schedulePersistA2ui(filePath: string) {
  persistFilePath = filePath
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    const fp = persistFilePath
    persistFilePath = null
    if (fp) void persistA2uiData(fp)
  }, 600)
}

/** 统一提交点：更新缓存 + od:a2ui-update 回推重渲染 + 排程写盘 */
function commitA2ui(ctx: SubtypeHandlerContext, filePath: string, doc: unknown) {
  a2uiCache.set(filePath, doc)
  ctx.postMessageToIframe?.({ type: "od:a2ui-update", payload: doc })
  schedulePersistA2ui(filePath)
}

export type PrototypeQuickFixData = {
  elementId: string
  componentType: string
  currentClass: string
  elementProps: string
  elementRect: { top: number; left: number; width: number; height: number }
}

const PROTOTYPE_QUICK_FIX_EVENT = "prototype:quick-fix"

export function dispatchPrototypeQuickFix(data: PrototypeQuickFixData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_QUICK_FIX_EVENT, { detail: data }))
}

export function onPrototypeQuickFix(handler: (data: PrototypeQuickFixData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeQuickFixData>).detail)
  window.addEventListener(PROTOTYPE_QUICK_FIX_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_QUICK_FIX_EVENT, listener)
}

const PROTOTYPE_CLOSE_PANELS_EVENT = "prototype:close-panels"

export function dispatchPrototypeClosePanels() {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_CLOSE_PANELS_EVENT))
}

export function onPrototypeClosePanels(handler: () => void) {
  const listener = () => handler()
  window.addEventListener(PROTOTYPE_CLOSE_PANELS_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_CLOSE_PANELS_EVENT, listener)
}

/** 关闭所有 prototype 编辑浮层并解冻 iframe 内 DOM picker（清除选中标记，恢复可选状态） */
export function closePrototypePanels() {
  sendToPrototypeIframe({ type: "od:dom-picker-unfreeze" })
  dispatchPrototypeClosePanels()
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

/** 应用一次属性编辑到当前 prototype 的 A2UI JSON 并 od:a2ui-update 回推重渲染。
 *  state 绑定字段（{ path }）保留绑定，把新值写入 doc.state 对应路径；普通属性直接改 props，按原值类型转换。 */
export function applyPrototypeModify(data: PrototypeModifyData) {
  const ctx = currentCtx
  if (!ctx) return
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return
  const current = a2uiCache.get(filePath)
  if (!current || typeof current !== "object") return
  const doc = JSON.parse(JSON.stringify(current)) as {
    state?: Record<string, unknown>
    elements?: Array<{ id: string; props?: Record<string, unknown> }>
  }
  const elements = doc.elements
  if (!Array.isArray(elements)) return
  const baseId = data.elementId.replace(/(:\d+)+$/, "")
  const el = elements.find((e) => e.id === baseId)
  if (!el) return
  el.props = el.props || {}
  if (data.className) el.props.className = data.className
  if (data.textContent) el.props.value = data.textContent
  if (data.componentProps) {
    for (const key of Object.keys(data.componentProps)) {
      const prev = el.props[key]
      const val = data.componentProps[key]
      if (prev && typeof prev === "object" && !Array.isArray(prev)) {
        const path = (prev as Record<string, unknown>).path
        if (typeof path === "string") {
          writeStateBinding(doc.state, path, val)
          continue
        }
      }
      el.props[key] = coercePropValue(prev, val)
    }
  }
  commitA2ui(ctx, filePath, doc)
}

/** 按原值类型把 string/boolean 转成 boolean/number，避免把 "true" 字符串塞进布尔/数字字段 */
function coercePropValue(prev: unknown, val: string | boolean): string | boolean | number {
  if (typeof prev === "boolean" && typeof val === "string") return val === "true"
  if (typeof prev === "number") {
    const n = Number(val)
    return isNaN(n) ? val : n
  }
  return val
}

/** 沿 path（如 /a/b/c）遍历 doc.state，把 value 写到目标叶子（按原值类型转换）；路径不存在则放弃 */
function writeStateBinding(state: Record<string, unknown> | undefined, path: string, value: string | boolean) {
  if (!state || typeof state !== "object") return
  const parts = path.replace(/^\//, "").split("/").filter(Boolean)
  let target: Record<string, unknown> = state
  for (let i = 0; i < parts.length - 1; i++) {
    const next = target[parts[i]]
    if (!next || typeof next !== "object" || Array.isArray(next)) return
    target = next as Record<string, unknown>
  }
  const lastKey = parts[parts.length - 1]
  if (lastKey in target) {
    target[lastKey] = coercePropValue(target[lastKey], value)
  }
}

/** 转义字符串使其可安全嵌入 RegExp 字面量（用于把 componentId 拼进 id 匹配正则）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 拖拽换序：在 A2UI JSON 中重排同级 children（静态 string[] 或循环 {path,componentId}）并 od:a2ui-update 回推 */
export function applyPrototypeReorder(elementId: string, targetSiblingId: string, position: "before" | "after") {
  const ctx = currentCtx
  if (!ctx) return
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return
  const current = a2uiCache.get(filePath)
  if (!current || typeof current !== "object") return
  const doc = JSON.parse(JSON.stringify(current)) as {
    state?: Record<string, unknown>
    elements?: Array<{ id: string; children?: unknown }>
  }
  const elements = doc.elements
  if (!Array.isArray(elements)) return

  const matchChildId = (children: string[], id: string) => {
    if (children.includes(id)) return id
    const baseId = id.replace(/(:\d+)+$/, "")
    return children.includes(baseId) ? baseId : null
  }

  const reorderLoopChildren = (children: { path: string; componentId: string }) => {
    const sourceMatch = elementId.match(new RegExp(`^${escapeRegExp(children.componentId)}:(\\d+)$`))
    const targetMatch = targetSiblingId.match(new RegExp(`^${escapeRegExp(children.componentId)}:(\\d+)$`))
    const list = children.path.replace(/^\//, "").split("/").reduce<unknown>((value, key) => {
      if (!value || typeof value !== "object") return undefined
      return (value as Record<string, unknown>)[key]
    }, doc.state)
    if (!sourceMatch || !targetMatch || !Array.isArray(list)) return false
    const sourceIndex = Number(sourceMatch[1])
    const targetIndex = Number(targetMatch[1])
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= list.length || targetIndex >= list.length) return false
    const reordered = list.filter((_, index) => index !== sourceIndex)
    const targetOffset = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    reordered.splice(position === "before" ? targetOffset : targetOffset + 1, 0, list[sourceIndex])
    list.splice(0, list.length, ...reordered)
    return true
  }

  for (const el of elements) {
    if (el.children && !Array.isArray(el.children) && reorderLoopChildren(el.children as { path: string; componentId: string })) {
      commitA2ui(ctx, filePath, doc)
      return
    }
    if (!Array.isArray(el.children)) continue
    const kids = el.children as string[]
    const sourceId = matchChildId(kids, elementId)
    const targetId = matchChildId(kids, targetSiblingId)
    if (!sourceId || !targetId || sourceId === targetId) continue
    const filtered = kids.filter(id => id !== sourceId)
    const idx = filtered.indexOf(targetId)
    filtered.splice(position === "before" ? idx : idx + 1, 0, sourceId)
    el.children = filtered
    commitA2ui(ctx, filePath, doc)
    return
  }
  console.warn("[prototype] reorder: no matching parent found for", elementId, "->", targetSiblingId)
}

export default {
  name: 'prototype',

  async handleLocalEdit(ctx) {
    const next = !editing
    ctx.postMessageToIframe?.({ type: "od:dom-picker-mode", enabled: next })
    if (!next) {
      ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: false })
      resetPrototypeEditing()
      return true
    }
    editing = true
    currentCtx = ctx
    // 先挂 message 监听再 await 加载 A2UI 数据，避免 iframe 在 await 窗口内回发的
    // od:a2ui-ready / od:dom-picker-quick-fix 等消息丢失。
    if (!messageHandler) {
      messageHandler = (e: MessageEvent) => {
        const d = e.data
        if (!d || typeof d !== "object") return
        const t = d.type
        if (typeof t !== "string") return
        if (!t.startsWith("od:dom-picker") && t !== "od:drag-reorder" && t !== "od:a2ui-ready") return
        if (t === "od:dom-picker-rect-update") {
          // TODO: 把新 rect 回推到 PrototypePropertyEditor 让弹层跟随元素 resize，
          // 当前先静默忽略以去除 console 噪声。
          return
        }
        if (t === "od:dom-picker-context-menu") {
          const iframe = currentCtx?.iframeElementGetter?.()
          const rect = iframe?.getBoundingClientRect()
          // iframe 隐藏（offsetWidth=0）时坐标换算无意义，直接放弃，避免菜单飞到屏幕外。
          if (!rect || !iframe || iframe.offsetWidth === 0) return
          const scale = rect.width / iframe.offsetWidth
          dispatchPrototypeCtxMenu({
            x: rect.left + (d.clickX ?? 0) * scale,
            y: rect.top + (d.clickY ?? 0) * scale,
            id: String(d.id ?? ""),
            tagName: String(d.tagName ?? ""),
          })
          return
        }
        if (t === "od:dom-picker-quick-fix") {
          const iframe = currentCtx?.iframeElementGetter?.()
          const rect = iframe?.getBoundingClientRect()
          if (!rect || !iframe || iframe.offsetWidth === 0) return
          const scale = rect.width / iframe.offsetWidth
          const er = d.rect
          dispatchPrototypeQuickFix({
            elementId: String(d.id ?? ""),
            componentType: String(d.domPickerComponent || d.tagName || ""),
            currentClass: String(d.domPickerClass ?? ""),
            elementProps: String(d.elementProps ?? ""),
            elementRect: er ? {
              top: rect.top + (er?.top ?? 0) * scale,
              left: rect.left + (er?.left ?? 0) * scale,
              width: (er?.width ?? 0) * scale,
              height: (er?.height ?? 0) * scale,
            } : { top: 0, left: 0, width: 0, height: 0 },
          })
          return
        }
        if (t === "od:dom-picker-close-panels") {
          closePrototypePanels()
          return
        }
        if (t === "od:drag-reorder") {
          applyPrototypeReorder(
            String(d.elementId ?? ""),
            String(d.targetSiblingId ?? ""),
            d.position === "after" ? "after" : "before",
          )
          return
        }
        console.log("[prototype] iframe message:", t, d)
      }
      window.addEventListener("message", messageHandler)
    }
    const siblingMap = buildSiblingMap(await loadA2uiData(ctx))
    ctx.postMessageToIframe?.({ type: "od:drag-mode", enabled: true, siblingMap })
    return true
  },
} satisfies SubtypeHandler
