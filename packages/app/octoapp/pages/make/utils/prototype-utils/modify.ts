import type { PrototypeModifyData, PrototypeSession } from "./types"
import { getSession } from "./session"
import { commitA2ui } from "./a2ui"

/** 按原值类型把 string/boolean 转成 boolean/number，避免把 "true" 字符串塞进布尔/数字字段 */
function coercePropValue(prev: unknown, val: string | boolean | object): string | boolean | number | object {
  if (typeof prev === "boolean" && typeof val === "string") return val === "true"
  if (typeof prev === "number") {
    const n = Number(val)
    return isNaN(n) ? val : n
  }
  return val
}

/** 识别 prototype a2ui 的 state 绑定形状 { path: "/a/b" } */
function isStateBound(v: unknown): v is { path: string } {
  return v !== null && typeof v === "object" && !Array.isArray(v) && typeof (v as { path?: unknown }).path === "string"
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

/** 解析循环实例 elementId（如 comp:0 或 comp:0:1 嵌套）到 state 中各级循环的数组路径与索引。
 *  沿父链上溯，对每个循环祖先（children={path,componentId}）记录 arrayPath + 对应 index。
 *  返回从外到内的层级列表；无法解析返回 null。 */
function resolveLoopPath(
  baseId: string,
  elements: Array<{ id: string; children?: unknown }>,
  indices: number[],
): Array<{ arrayPath: string[]; index: number }> | null {
  const parentMap = new Map<string, string>()
  for (const el of elements) {
    if (Array.isArray(el.children)) {
      for (const childId of el.children) parentMap.set(childId, el.id)
    } else if (el.children && typeof el.children === "object" && !Array.isArray(el.children)) {
      const cid = (el.children as Record<string, unknown>).componentId
      if (typeof cid === "string") parentMap.set(cid, el.id)
    }
  }
  let current = baseId
  let idx = 0
  const levels: Array<{ arrayPath: string[]; index: number }> = []
  while (true) {
    const parentId = parentMap.get(current)
    if (!parentId) break
    const parent = elements.find((e) => e.id === parentId)
    if (!parent) break
    if (parent.children && typeof parent.children === "object" && !Array.isArray(parent.children)) {
      const p = (parent.children as Record<string, unknown>).path
      if (typeof p === "string") {
        const arrayPath = p.replace(/^\//, "").split("/").filter(Boolean)
        const ii = indices.length - 1 - idx
        if (ii >= 0) levels.unshift({ arrayPath, index: indices[ii] })
        idx++
      }
    }
    current = parentId
  }
  return levels.length === 0 ? null : levels
}

/** 沿 pathParts 逐段取值；遇到非对象/数组则返回 undefined。 */
function navigatePath(target: unknown, pathParts: string[]): unknown {
  let cur: unknown = target
  for (const p of pathParts) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** 把绑定值写入循环实例在 state 中的对应数组项。levels 为 resolveLoopPath 的返回值（外→内）。 */
function writeLoopBindings(
  state: Record<string, unknown> | undefined,
  levels: Array<{ arrayPath: string[]; index: number }>,
  bindings: { path: string; value: string | boolean }[],
) {
  if (!state || typeof state !== "object" || levels.length === 0) return
  let target: unknown = state
  for (let l = 0; l < levels.length - 1; l++) {
    const arr = navigatePath(target, levels[l].arrayPath)
    if (!Array.isArray(arr) || levels[l].index >= arr.length) return
    target = arr[levels[l].index]
  }
  const last = levels[levels.length - 1]
  const arr = navigatePath(target, last.arrayPath)
  if (!Array.isArray(arr) || last.index >= arr.length) return
  const item = { ...((arr[last.index] as Record<string, unknown>) ?? {}) }
  for (const b of bindings) {
    const pathParts = b.path.replace(/^\//, "").split("/").filter(Boolean)
    let t: Record<string, unknown> = item
    for (let j = 0; j < pathParts.length - 1; j++) {
      const k = pathParts[j]
      if (!t[k] || typeof t[k] !== "object" || Array.isArray(t[k])) t[k] = {}
      t = t[k] as Record<string, unknown>
    }
    const lastKey = pathParts[pathParts.length - 1]
    if (lastKey) t[lastKey] = coercePropValue(t[lastKey], b.value)
  }
  ;(arr as unknown[])[last.index] = item
}

/** 应用一次属性编辑到当前 prototype 的 A2UI JSON 并 od:a2ui-update 回推重渲染。
 *  循环实例（elementId 含 :N 后缀）：绑定字段写入 state 中对应数组项；普通字段改模板 props。
 *  非循环：绑定字段按 path 直写 state；普通字段改元素 props。 */
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
    elements?: Array<{ id: string; props?: Record<string, unknown>; children?: unknown }>
  }
  const elements = doc.elements
  if (!Array.isArray(elements)) return
  const instanceMatch = data.elementId.match(/^(.+?)((:\d+)+)$/)
  const baseId = instanceMatch ? instanceMatch[1] : data.elementId
  const el = elements.find((e) => e.id === baseId)
  if (!el) return
  el.props = el.props || {}

  const bindings: { path: string; value: string | boolean }[] = []
  const applyProp = (key: string, prev: unknown, value: string | boolean | object) => {
    if (isStateBound(prev)) {
      if (value !== "[object Object]") bindings.push({ path: prev.path, value: value as string | boolean })
      return
    }
    el.props![key] = coercePropValue(prev, value)
  }

  if (data.className) applyProp("className", el.props.className, data.className)
  if (data.textContent) applyProp("value", el.props.value, data.textContent)
  if (data.componentProps) {
    for (const key of Object.keys(data.componentProps)) {
      applyProp(key, el.props[key], data.componentProps[key])
    }
  }

  if (bindings.length > 0) {
    if (instanceMatch) {
      const indices = instanceMatch[2].split(":").filter(Boolean).map(Number)
      const levels = resolveLoopPath(baseId, elements, indices)
      if (levels) writeLoopBindings(doc.state, levels, bindings)
    } else {
      for (const b of bindings) writeStateBinding(doc.state, b.path, b.value)
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
