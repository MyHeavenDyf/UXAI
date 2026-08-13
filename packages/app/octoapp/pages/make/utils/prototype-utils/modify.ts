import type { PrototypeModifyData, PrototypeSession } from "./types"
import { getSession } from "./session"
import { commitA2ui } from "./a2ui"

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

/** 应用一次属性编辑到当前 prototype 的 A2UI JSON 并 od:a2ui-update 回推重渲染。
 *  state 绑定字段（{ path }）保留绑定，把新值写入 doc.state 对应路径；普通属性直接改 props，按原值类型转换。 */
export function applyPrototypeModify(data: PrototypeModifyData) {
  const session = getSession()
  if (!session) return
  const ctx = session.ctx
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return
  const current = session.a2ui?.doc
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
  commitA2ui(session, filePath, doc)
}

/** 拖拽换序：在 A2UI JSON 中重排同级 children（静态 string[] 或循环 {path,componentId}）并 od:a2ui-update 回推 */
export function applyPrototypeReorder(elementId: string, targetSiblingId: string, position: "before" | "after") {
  const session = getSession()
  if (!session) return
  const ctx = session.ctx
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return
  const current = session.a2ui?.doc
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
      commitA2ui(session, filePath, doc)
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
    commitA2ui(session, filePath, doc)
    return
  }
  console.warn("[prototype] reorder: no matching parent found for", elementId, "->", targetSiblingId)
}
