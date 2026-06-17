import { createSignal } from "solid-js"
import type { OutputCard, ArtifactExportKind } from "../insight-turn"

export type ResultTab = {
  id: string
  title: string
  type: "table" | "mindmap" | "markdown" | "file" | "json" | "html" | "deck" | "svg" | "markdown-document" | "code-snippet" | "react-component" | "diagram"
  content: string
  filePath?: string
  exports?: ArtifactExportKind[]
  artifactIdentifier?: string
  createdAt: Date
}

export function createTabStore() {
  const [tabs, setTabs] = createSignal<ResultTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  function openTab(card: OutputCard) {
    const existing = tabs().find((t) => t.id === card.id)
    if (existing) {
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

  function closeTab(id: string) {
    setTabs((prev) => {
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

  return { tabs, activeId, activate, openTab, closeTab, updateTabContent, reset }
}

export type TabStore = ReturnType<typeof createTabStore>
