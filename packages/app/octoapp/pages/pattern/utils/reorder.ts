import type { A2UIDocument } from "./a2ui-protocol"
import type { VersionEntry } from "./version-history"
import { appendPatternVersion } from "./version-history"
import { saveDebugSnapshot, clearDebugLog } from "./debug-log"

export type ReorderContext = {
  getPendingData: () => unknown
  sendToPreview: (data: unknown) => void
  getSessionId: () => string | undefined
  getHistoryDir: () => string
  getLastIntent: () => Record<string, unknown> | null
  getLastPlanner: () => Record<string, unknown> | null
  getLastModules: () => Array<Record<string, unknown>>
  setVersions: (fn: (prev: VersionEntry[]) => VersionEntry[]) => void
  setCurrentVersionId: (id: string) => void
}

/**
 * 创建 A2UI 元素拖拽重排序处理器。
 * 在 A2UI JSON 中重新排列同级 children，支持两种模式：
 * 1. 静态 children（string[]）— 直接数组重排
 * 2. 循环 children（{ path, componentId }）— 通过路径定位 state 中的数组并重排
 *
 * 重排后自动保存历史版本（带 2s 节流）和调试日志。
 */
export function createReorderHandler(ctx: ReorderContext) {
  let lastSave = 0
  const THROTTLE_MS = 2000

  const saveHistory = (clone: A2UIDocument, sourceId: string, extra: Record<string, unknown>) => {
    const now = Date.now()
    const sid = ctx.getSessionId()
    const dir = ctx.getHistoryDir()
    if (!sid || !dir || now - lastSave < THROTTLE_MS) return
    lastSave = now
    const summary = `重新排序: ${sourceId}`
    void appendPatternVersion(dir, sid, {
      lastIntent: ctx.getLastIntent(),
      lastPlanner: ctx.getLastPlanner(),
      lastModules: ctx.getLastModules(),
      mergedA2UI: clone as unknown as Record<string, unknown>,
    }, summary).then((vid) => {
      if (ctx.getSessionId() !== sid) return
      ctx.setVersions((prev) => [...prev, { id: vid, createdAt: Date.now(), summary }])
      ctx.setCurrentVersionId(vid)
    })
    void saveDebugSnapshot(dir, sid, "modify", {
      lastIntent: ctx.getLastIntent(),
      lastPlanner: ctx.getLastPlanner(),
      lastModules: ctx.getLastModules(),
      mergedA2UI: clone as unknown as Record<string, unknown>,
      summary,
      extra,
    })
    clearDebugLog()
  }

  return function handleReorder(elementId: string, targetSiblingId: string, position: "before" | "after") {
    const doc = ctx.getPendingData() as A2UIDocument | null
    if (!doc?.elements) {
      console.warn("[reorder] no pending data or elements")
      return
    }

    // 匹配 children 中的 ID，支持带后缀的实例 ID（如 "btn:0" → "btn"）
    const matchChildId = (children: string[], id: string) => {
      if (children.includes(id)) return id
      const baseId = id.replace(/(:\d+)+$/, "")
      return children.includes(baseId) ? baseId : null
    }

    // 循环渲染 children：通过 componentId + 索引匹配，从 state 中定位数组并原地重排
    const reorderLoopChildren = (children: { path: string; componentId: string }) => {
      const sourceMatch = elementId.match(new RegExp(`^${children.componentId}:(\\d+)$`))
      const targetMatch = targetSiblingId.match(new RegExp(`^${children.componentId}:(\\d+)$`))
      const list = children.path.replace(/^\//, "").split("/").reduce<unknown>((value, key) => {
        if (!value || typeof value !== "object") return undefined
        return (value as Record<string, unknown>)[key]
      }, clone.state)
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

    const clone = JSON.parse(JSON.stringify(doc)) as A2UIDocument
    for (const el of clone.elements) {
      // 循环 children
      if (el.children && !Array.isArray(el.children) && reorderLoopChildren(el.children)) {
        console.log("[reorder] loop success:", elementId, position, targetSiblingId, "in parent", el.id)
        ctx.sendToPreview(clone)

        saveHistory(clone, elementId.replace(/(:\d+)+$/, ""), {
          reorderData: { elementId, targetSiblingId, position },
          parentId: el.id,
        })

        return
      }
      // 静态 children
      if (!Array.isArray(el.children)) continue
      const kids = el.children as string[]
      const sourceId = matchChildId(kids, elementId)
      const targetId = matchChildId(kids, targetSiblingId)
      if (!sourceId || !targetId || sourceId === targetId) continue
      const beforeChildren = [...kids]
      const filtered = kids.filter(id => id !== sourceId)
      const idx = filtered.indexOf(targetId)
      filtered.splice(position === "before" ? idx : idx + 1, 0, sourceId)
      el.children = filtered
      console.log("[reorder] success:", sourceId, position, targetId, "in parent", el.id)
      ctx.sendToPreview(clone)

      saveHistory(clone, sourceId, {
        reorderData: { elementId, targetSiblingId, position, sourceId, targetId },
        beforeChildren,
        afterChildren: filtered,
        parentId: el.id,
      })

      return
    }
    console.warn("[reorder] no matching parent found for", elementId, "->", targetSiblingId, "(may be loop-bound children)")
  }
}
