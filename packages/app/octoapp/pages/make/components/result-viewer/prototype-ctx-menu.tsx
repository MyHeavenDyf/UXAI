import { createSignal, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"
import JSZip from "jszip"
import { showOctoToast } from "../octo-toast"
import { getDesktopApi } from "../../lib/electron-api"
import { TaskStore } from "@/context/task"
import { tracker } from "@/utils/tracker"
import { onPrototypeCtxMenu, onPrototypeClosePanels, sendToPrototypeIframe, getSession, loadA2uiData, closePrototypePanels, type PrototypeCtxMenuData } from "../../utils/prototype-utils"

const MENU_WIDTH = 160
const MENU_HEIGHT = 108

const itemBase: JSX.CSSProperties = {
  padding: "8px 12px",
  "font-size": "13px",
  cursor: "pointer",
  color: "var(--octo-text-primary, #191919)",
}

type A2uiElement = { id: string; children?: unknown; props?: Record<string, unknown> }
type A2uiDoc = { state?: Record<string, unknown>; rootId?: string; elements?: A2uiElement[] }

/** 识别 a2ui 的 state 绑定形状 { path: "xxx" | "/xxx" } */
function isStateBound(v: unknown): v is { path: string } {
  return v !== null && typeof v === "object" && !Array.isArray(v) && typeof (v as { path?: unknown }).path === "string"
}

/** 递归遍历 props/children 结构，收集所有 state 绑定路径（循环模板内相对路径 → 取 loopPath） */
function collectPaths(v: unknown, paths: Set<string>, loopPath?: string) {
  if (isStateBound(v)) {
    if (loopPath && !v.path.startsWith("/")) {
      paths.add(loopPath)
    } else {
      paths.add(v.path)
    }
    return
  }
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) {
      for (const item of v) collectPaths(item, paths, loopPath)
    } else {
      for (const val of Object.values(v)) collectPaths(val, paths, loopPath)
    }
  }
}

/** 递归收集选中元素及其所有子元素 ID（支持数组 children 和循环对象 children） */
function collectDescendantIds(root: A2uiElement, elementsById: Map<string, A2uiElement>): Set<string> {
  const ids = new Set<string>([root.id])
  const walk = (el: A2uiElement) => {
    const children = el.children
    if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child !== "string" || ids.has(child)) continue
        ids.add(child)
        const childEl = elementsById.get(child)
        if (childEl) walk(childEl)
      }
    } else if (children && typeof children === "object" && !Array.isArray(children)) {
      const cid = (children as Record<string, unknown>).componentId
      if (typeof cid === "string" && !ids.has(cid)) {
        ids.add(cid)
        const childEl = elementsById.get(cid)
        if (childEl) walk(childEl)
      }
    }
  }
  walk(root)
  return ids
}

/** 按路径集合从 state 中摘取对应字段，构建精简 state 子集 */
function pickStatePaths(state: Record<string, unknown>, paths: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const path of paths) {
    const parts = path.replace(/^\//, "").split("/").filter(Boolean)
    if (parts.length === 0) continue
    let src: unknown = state
    let dst: Record<string, unknown> = result
    for (let i = 0; i < parts.length - 1; i++) {
      src = (src as Record<string, unknown> | null)?.[parts[i]]
      if (src === undefined) break
      if (!dst[parts[i]]) dst[parts[i]] = {}
      dst = dst[parts[i]] as Record<string, unknown>
    }
    if (src !== undefined) {
      const leaf = parts[parts.length - 1]
      dst[leaf] = (src as Record<string, unknown>)[leaf]
    }
  }
  return result
}

/**
 * 从完整 a2ui 文档中提取选中元素及其子树所需的精简数据。
 * 循环实例（如 mainMetricCard:0）→ state 取对应数组项 + 绝对路径字段；普通元素 → state 取引用字段。
 */
function extractPatternData(doc: A2uiDoc, elementId: string) {
  const elements = doc.elements ?? []
  const elementsById = new Map(elements.map((e) => [e.id, e]))

  // 解析循环实例 ID（如 mainMetricCard:0:1 → baseId=mainMetricCard, indices=[0,1]）
  const instanceMatch = elementId.match(/^(.+?)((:\d+)+)$/)
  const baseId = instanceMatch ? instanceMatch[1] : elementId
  const instanceIndices = instanceMatch ? instanceMatch[2].slice(1).split(":").map(Number) : []

  const matchedElement = elementsById.get(baseId)
  if (!matchedElement) return null

  // 构建元素关系图：parentMap（元素→父）和 loopPathsByElement（循环模板→state 数组路径）
  const parentMap = new Map<string, string>()
  const loopPathsByElement = new Map<string, string>()
  for (const el of elements) {
    if (Array.isArray(el.children)) {
      for (const childId of el.children) {
        if (typeof childId === "string") parentMap.set(childId, el.id)
      }
    } else if (el.children && typeof el.children === "object" && !Array.isArray(el.children)) {
      const cid = (el.children as Record<string, unknown>).componentId
      const p = (el.children as Record<string, unknown>).path
      if (typeof cid === "string") parentMap.set(cid, el.id)
      if (typeof cid === "string" && typeof p === "string") loopPathsByElement.set(cid, p)
    }
  }

  // 沿父链上溯，收集循环层级（path + 实例索引），从外到内
  const loopLevels: Array<{ path: string; index: number }> = []
  const visited = new Set<string>()
  let current = baseId
  let idxPtr = instanceIndices.length
  while (current && !visited.has(current)) {
    visited.add(current)
    const lp = loopPathsByElement.get(current)
    if (lp) {
      idxPtr--
      loopLevels.unshift({ path: lp, index: instanceIndices[idxPtr] ?? 0 })
    }
    current = parentMap.get(current)!
  }

  // 沿父链查找元素所属循环路径（带缓存）
  const loopPathCache = new Map<string, string | undefined>()
  const resolveLoopPath = (id: string): string | undefined => {
    if (loopPathCache.has(id)) return loopPathCache.get(id)
    const direct = loopPathsByElement.get(id)
    if (direct) { loopPathCache.set(id, direct); return direct }
    const parent = parentMap.get(id)
    if (parent) {
      const inherited = resolveLoopPath(parent)
      loopPathCache.set(id, inherited)
      return inherited
    }
    loopPathCache.set(id, undefined)
    return undefined
  }

  // 收集选中元素及其子元素
  const matchedIds = collectDescendantIds(matchedElement, elementsById)
  const filteredElements = elements.filter((e) => matchedIds.has(e.id))

  // 收集被引用的 state 路径
  const usedStatePaths = new Set<string>()
  for (const el of filteredElements) {
    const lp = resolveLoopPath(el.id)
    if (el.props) {
      for (const v of Object.values(el.props)) collectPaths(v, usedStatePaths, lp)
    }
    if (el.children && typeof el.children === "object" && !Array.isArray(el.children)) {
      const childPath = (el.children as Record<string, unknown>).path
      if (typeof childPath === "string") usedStatePaths.add(childPath)
    }
  }

  // 构建 state
  let filteredState: Record<string, unknown> = {}
  if (loopLevels.length > 0) {
    // 循环实例：导航到 state 数组项 + 绝对路径字段
    let loopItem: Record<string, unknown> = {}
    let cur: unknown = doc.state ?? {}
    for (const level of loopLevels) {
      const parts = level.path.replace(/^\//, "").split("/").filter(Boolean)
      for (const p of parts) {
        cur = (cur as Record<string, unknown> | null)?.[p]
        if (cur === undefined) break
      }
      if (!Array.isArray(cur)) { cur = {}; break }
      cur = cur[level.index] ?? {}
    }
    loopItem = (cur as Record<string, unknown>) ?? {}

    const absolutePaths = new Set([...usedStatePaths].filter((p) => p.startsWith("/")))
    filteredState = loopItem
    if (doc.state && absolutePaths.size > 0) {
      filteredState = { ...pickStatePaths(doc.state, absolutePaths), ...loopItem }
    }
  } else if (doc.state && usedStatePaths.size > 0) {
    // 普通元素：直接按路径摘取
    filteredState = pickStatePaths(doc.state, usedStatePaths)
  }

  return { state: filteredState, rootId: baseId, elements: filteredElements }
}

/** 下载 Blob 到本地文件（优先使用桌面 API 的保存对话框） */
function downloadBlob(content: Uint8Array, filename: string, mimeType: string) {
  const blob = new Blob([content.buffer as ArrayBuffer], { type: mimeType })
  const api = getDesktopApi()
  if (api?.saveFilePicker && api?.writeFileBuffer) {
    api.saveFilePicker({ defaultPath: filename }).then(async (chosen) => {
      if (!chosen) return
      await api.writeFileBuffer!(chosen, await blob.arrayBuffer())
      showOctoToast({ title: "已下载" })
    })
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showOctoToast({ title: "已下载" })
}

export function PrototypeCtxMenu(): JSX.Element {
  const [menu, setMenu] = createSignal<PrototypeCtxMenuData | null>(null)
  const close = () => setMenu(null)

  const unsubscribe = onPrototypeCtxMenu((data) => {
    const x = Math.max(8, Math.min(data.x, window.innerWidth - MENU_WIDTH - 8))
    const y = Math.max(8, Math.min(data.y, window.innerHeight - MENU_HEIGHT - 8))
    setMenu({ ...data, x, y })
  })
  onCleanup(unsubscribe)
  const unsubClose = onPrototypeClosePanels(() => close())
  onCleanup(unsubClose)

  const handleSelectParent = () => {
    sendToPrototypeIframe({ type: "od:dom-picker-select-parent" })
    close()
  }

  const handleCopyName = () => {
    const id = menu()?.id ?? ""
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(id).then(() => showOctoToast({ title: "已复制" })).catch(() => {})
    }
    close()
  }

  // 下载选中元素的 Pattern：提取精简 JSON（state + elements），打包为 zip
  const handleDownload = async () => {
    const elementId = menu()?.id ?? ""
    close()
    closePrototypePanels()

    const session = getSession()
    if (!session?.ctx) {
      showOctoToast({ title: "无法获取当前会话" })
      return
    }

    tracker.interaction({ module: "design", name: "download-pattern", extend: JSON.stringify({ elementId }) })

    const taskId = `download-pattern-${Date.now()}`
    TaskStore.add([{
      key: taskId,
      taskId,
      type: "download",
      serviceType: "octo_download",
      name: `${session.ctx.tab.title}-pattern`,
      size: 0,
      status: "in_progress",
      hasProgress: false,
      canCancel: false,
      createdAt: Date.now(),
    }])

    try {
      const a2uiData = await loadA2uiData(session, session.ctx)
      if (!a2uiData || typeof a2uiData !== "object") {
        TaskStore.error([{ key: taskId, status: "error" }])
        showOctoToast({ title: "无法读取原型数据" })
        return
      }

      const pattern = extractPatternData(a2uiData as A2uiDoc, elementId)
      if (!pattern) {
        TaskStore.error([{ key: taskId, status: "error" }])
        showOctoToast({ title: "未找到选中的元素" })
        return
      }

      const zip = new JSZip()
      zip.file("data.json", JSON.stringify(pattern, null, 2))
      const zipBlob = await zip.generateAsync({ type: "uint8array" })
      const zipName = `${session.ctx.tab.title}-pattern-${Date.now()}.zip`
      downloadBlob(zipBlob, zipName, "application/zip")

      TaskStore.finish([{ key: taskId, status: "completed" }])
    } catch (error) {
      TaskStore.error([{ key: taskId, status: "error" }])
      showOctoToast({
        title: "下载失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "error"
      })
    }
  }

  const onDocClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest(".prototype-ctx-menu")) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close()
  }
  window.addEventListener("click", onDocClick, true)
  window.addEventListener("keydown", onKey)
  onCleanup(() => {
    window.removeEventListener("click", onDocClick, true)
    window.removeEventListener("keydown", onKey)
  })

  return (
    <Show when={menu()}>
      {(m) => (
        <Portal mount={document.body}>
          <div
            class="prototype-ctx-menu"
            style={{
              position: "fixed",
              "z-index": "99999",
              left: `${m().x}px`,
              top: `${m().y}px`,
              width: `${MENU_WIDTH}px`,
              background: "#ffffff",
              border: "1px solid var(--octo-border-default, #E5E7EB)",
              "border-radius": "8px",
              "box-shadow": "var(--octo-shadow-md, 0 4px 16px rgba(0,0,0,0.08))",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={itemBase}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={handleSelectParent}
            >
              选择父容器
            </div>
            <div
              style={{ ...itemBase, "border-top": "1px solid var(--octo-border-default, #E5E7EB)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={handleCopyName}
            >
              复制名称
            </div>
            <div
              style={{ ...itemBase, "border-top": "1px solid var(--octo-border-default, #E5E7EB)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={handleDownload}
            >
              下载Pattern
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}
