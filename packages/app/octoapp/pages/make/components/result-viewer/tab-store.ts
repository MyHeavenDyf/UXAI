import { createSignal } from "solid-js"
import type { OutputCard, ArtifactExportKind } from "../insight-turn"

export type ResultTab = {
  id: string
  title: string
  type: "table" | "mindmap" | "markdown" | "file" | "json" | "html" | "deck" | "svg" | "markdown-document" | "code-snippet" | "react-component" | "diagram" | "design-plan" | "local-file"
  content: string
  filePath?: string
  absoluteFilePath?: string
  exports?: ArtifactExportKind[]
  artifactIdentifier?: string
  pinned?: boolean
  createdAt: Date
}

export function createTabStore() {
  const [tabs, setTabs] = createSignal<ResultTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  function openTab(card: OutputCard) {
    const existing = tabs().find((t) => t.id === card.id)
    if (existing) {
      // 已存在:更新内容(支持方案迭代 — agent 用相同 identifier 多次输出方案时,内容会刷新)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === card.id
            ? { ...t, content: card.content, title: card.title, artifactIdentifier: card.artifactIdentifier ?? t.artifactIdentifier }
            : t,
        ),
      )
      setActiveId(card.id)
      return
    }
    const tab: ResultTab = {
      id: card.id,
      title: card.title,
      type: card.type,
      content: card.content,
      filePath: card.filePath,
      exports: card.exports,
      artifactIdentifier: card.artifactIdentifier,
      createdAt: card.createdAt,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(card.id)
  }

  function openLocalFileTab(params: {
    id: string
    title: string
    absoluteFilePath: string
    createdAt: Date
  }) {
    const existing = tabs().find((t) => t.id === params.id)
    if (existing) {
      setActiveId(params.id)
      return
    }
    const tab: ResultTab = {
      id: params.id,
      title: params.title,
      type: "local-file",
      content: "",
      absoluteFilePath: params.absoluteFilePath,
      createdAt: params.createdAt,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(params.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const target = prev.find((t) => t.id === id)
      // pinned tab 拒绝关闭(防御性,UI 已经不渲染关闭按钮)
      if (target?.pinned) return prev

      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const next = prev.filter((t) => t.id !== id)
      if (activeId() === id) {
        setActiveId(next[Math.max(0, idx - 1)]?.id ?? null)
      }
      return next
    })
  }

  function activate(id: string) {
    setActiveId(id)
  }

  function updateTabContent(id: string, content: string) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)))
  }

  function reset() {
    setTabs([])
    setActiveId(null)
  }

  return { tabs, activeId, activate, openTab, openLocalFileTab, closeTab, updateTabContent, reset }
}

export type TabStore = ReturnType<typeof createTabStore>
