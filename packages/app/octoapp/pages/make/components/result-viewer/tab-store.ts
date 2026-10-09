import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { OutputCard, ArtifactExportKind } from "../insight-turn"
import { extractSubtypeFromFilename } from "../../utils/subtype-extractor"

export type ResultTab = {
  id: string
  title: string
  type: "table" | "mindmap" | "markdown" | "file" | "json" | "html" | "deck" | "svg" | "markdown-document" | "code-snippet" | "react-component" | "diagram" | "local-file" | "image" | "video" | "audio" | "pdf" | "text" | "design-plan" | "link"
  subtype?: string
  content: string
  filePath?: string
  commentFilePath?: string
  sessionId?: string
  absoluteFilePath?: string
  exports?: ArtifactExportKind[]
  artifactIdentifier?: string
  pinned?: boolean
  createdAt: Date
  lastActivatedAt?: number
  fromAttachment?: boolean  // 会话区点击附件打开 → 隐藏历史按钮
}

// ★ 用 createStore + produce 替代 createSignal:
//   produce 在 store 内部做最小变更,旧 tab 的 proxy 引用保留 → <For> 不会因
//   内容更新而重建 iframe(切 tab 时 iframe 仍挂载,只在 display 切换)。
//   注意:不能用 reconcile({key:"id"}) — reconcile 会创建新 proxy,引用不稳。
//   tabs 仍以函数形式暴露(保持调用方 tabs() 写法不变)。
export interface TabStoreOptions {
  // tab 列表结构变更(open/close/activate/rename 等)后的回调,用于按 session 持久化。
  // updateTabContent 不触发(避免编辑器每次键击写 localStorage);reset/restoreTabs 不触发。
  onPersist?: () => void
}

export function createTabStore(options?: TabStoreOptions) {
  const [tabsStore, setTabsStore] = createStore<ResultTab[]>([])
  const tabs = () => tabsStore
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const notify = () => options?.onPersist?.()

  function openTab(card: OutputCard) {
    setTabsStore(produce((s: ResultTab[]) => {
      const idx = s.findIndex(t => t.id === card.id)
      if (idx >= 0) {
        // 已存在:更新内容(支持方案迭代 — agent 用相同 identifier 多次输出方案时,内容会刷新)
        s[idx].content = card.content
        s[idx].title = card.title
        s[idx].artifactIdentifier = card.artifactIdentifier ?? s[idx].artifactIdentifier
        s[idx].lastActivatedAt = Date.now()
        return
      }
      s.push({
        id: card.id,
        title: card.title,
        type: card.type,
        subtype: card.subtype,
        content: card.content,
        filePath: card.filePath,
        commentFilePath: card.commentFilePath,
        sessionId: card.sessionId,
        exports: card.exports,
        artifactIdentifier: card.artifactIdentifier,
        createdAt: card.createdAt,
        lastActivatedAt: Date.now(),
        fromAttachment: card.fromAttachment,
      })
    }))
    setActiveId(card.id)
    notify()
  }

  function openLocalFileTab(params: {
    id: string
    title: string
    absoluteFilePath: string
    createdAt: Date
  }) {
    const existing = tabsStore.find((t) => t.id === params.id)
    if (existing) {
      activate(params.id)
      return
    }
    setTabsStore(produce((s: ResultTab[]) => {
      s.push({
        id: params.id,
        title: params.title,
        type: "local-file",
        subtype: extractSubtypeFromFilename(params.title),
        content: "",
        absoluteFilePath: params.absoluteFilePath,
        createdAt: params.createdAt,
        lastActivatedAt: Date.now(),
      })
    }))
    setActiveId(params.id)
    notify()
  }

  function closeTab(id: string) {
    const target = tabsStore.find((t) => t.id === id)
    // pinned tab 拒绝关闭(防御性,UI 已经不渲染关闭按钮)
    if (target?.pinned) return

    const idx = tabsStore.findIndex((t) => t.id === id)
    if (idx === -1) return
    if (activeId() === id) {
      // 计算激活切换目标后再 mutate(splice 后 idx 错位);直接索引,免分配
      const neighbor = idx > 0 ? tabsStore[idx - 1] : tabsStore[idx + 1]
      setActiveId(neighbor?.id ?? null)
    }
    setTabsStore(produce((s: ResultTab[]) => {
      const i = s.findIndex(t => t.id === id)
      if (i >= 0) s.splice(i, 1)
    }))
    notify()
  }

  function activate(id: string) {
    setTabsStore(produce((s: ResultTab[]) => {
      const idx = s.findIndex(t => t.id === id)
      if (idx >= 0) s[idx].lastActivatedAt = Date.now()
    }))
    setActiveId(id)
    notify()
  }

  function updateTabContent(id: string, content: string) {
    setTabsStore(produce((s: ResultTab[]) => {
      const idx = s.findIndex(t => t.id === id)
      if (idx >= 0) s[idx].content = content
    }))
  }

  function renameTabByPath(oldPath: string, newPath: string, newTitle: string) {
    const normalizedOld = oldPath.replace(/\\/g, "/")
    setTabsStore(produce((s: ResultTab[]) => {
      for (const t of s) {
        if (t.filePath && t.filePath.replace(/\\/g, "/") === normalizedOld) {
          t.filePath = newPath
          t.title = newTitle
        }
        if (t.absoluteFilePath && t.absoluteFilePath.replace(/\\/g, "/") === normalizedOld) {
          t.absoluteFilePath = newPath
          t.title = newTitle
        }
      }
    }))
    notify()
  }

  function reset() {
    setTabsStore(produce((s: ResultTab[]) => { s.length = 0 }))
    setActiveId(null)
  }

  // 批量恢复(切换 session/重新挂载后从持久化状态还原)。
  // 单次 produce 写入,保留 lastActivatedAt 以维持 html iframe 的 LRU 挂载顺序。
  // 不触发 onPersist:恢复内容与存档一致,无需回写。
  function restoreTabs(restored: ResultTab[], restoredActiveId: string | null) {
    setTabsStore(produce((s: ResultTab[]) => {
      s.length = 0
      s.push(...restored)
    }))
    const fallback = restored.length > 0 ? restored[restored.length - 1].id : null
    setActiveId(restored.some(t => t.id === restoredActiveId) ? restoredActiveId : fallback)
  }

  function addTabSilently(card: OutputCard) {
    setTabsStore(produce((s: ResultTab[]) => {
      const idx = s.findIndex(t => t.id === card.id)
      if (idx >= 0) {
        s[idx].content = card.content
        s[idx].title = card.title
        s[idx].artifactIdentifier = card.artifactIdentifier ?? s[idx].artifactIdentifier
        return
      }
      s.push({
        id: card.id,
        title: card.title,
        type: card.type,
        content: card.content,
        filePath: card.filePath,
        commentFilePath: card.commentFilePath,
        sessionId: card.sessionId,
        exports: card.exports,
        artifactIdentifier: card.artifactIdentifier,
        createdAt: card.createdAt,
        fromAttachment: card.fromAttachment,
      })
    }))
    notify()
  }

  return { tabs, activeId, activate, openTab, openLocalFileTab, closeTab, updateTabContent, addTabSilently, renameTabByPath, reset, restoreTabs }
}

export type TabStore = ReturnType<typeof createTabStore>
