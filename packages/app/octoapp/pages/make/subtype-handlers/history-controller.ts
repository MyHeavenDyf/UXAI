import { createHistoryStore, type VersionEntry, type HistoryActor } from "../utils/history-store"
import { getSubtypeHandler } from "../utils/subtype-registry"
import type { HistoryTriggerEvent, SubtypeHandlerContext } from "./types"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { getDesktopApi } from "../lib/electron-api"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"

const HISTORY_SKIP_TYPES = ["image", "video", "audio", "pdf", "svg", "text", "local-file"]

export interface HistoryControllerCallbacks {
  setVersionList: (updater: (prev: VersionEntry[]) => VersionEntry[]) => void
  setCurrentVersionId: (updater: (prev: string | null) => string | null) => void
  updateTabContent: (id: string, content: string) => void
  setFilesRefreshKey: (updater: (prev: number) => number) => void
}

export function createHistoryController(callbacks: HistoryControllerCallbacks) {
  const historyStore = createHistoryStore()
  const writingTabs = new Set<string>()
  const lastFileSize = new Map<string, number>()

  function buildCtx(tab: ResultTab): SubtypeHandlerContext {
    return {
      tab,
      showToast,
      tracker,
      getDesktopApi,
      extractCodeBlock: (text: string, lang: string) => {
        const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n?```", "i")
        const m = text.match(re)
        return m ? m[1].trim() : text.trim()
      },
      projectSelection: () => undefined,
      updateTabContent: callbacks.updateTabContent,
    }
  }

  function isEligible(tab: ResultTab): boolean {
    if (!tab.filePath || HISTORY_SKIP_TYPES.includes(tab.type)) return false
    if (tab.type === "link" || tab.filePath.startsWith("http")) return false
    return true
  }

  async function trigger(tab: ResultTab, event: HistoryTriggerEvent, actor: HistoryActor): Promise<void> {
    if (!isEligible(tab)) return
    const handler = getSubtypeHandler(tab.subtype)
    const ctx = buildCtx(tab)
    const files = handler?.onHistoryTrigger?.(event, ctx)
    if (!files || files.length === 0) return

    if (event.type === "open" && event.isNew) {
      const existing = await historyStore.listVersions(tab)
      if (existing.length > 0) {
        callbacks.setCurrentVersionId(() => existing[0]?.id ?? null)
        return
      }
    }

    const entry = await historyStore.recordVersion(tab, actor, files)
    if (entry) {
      callbacks.setVersionList((prev) => [entry, ...prev])
      callbacks.setCurrentVersionId(() => entry.id)
    }
  }

  async function switchVersion(entry: VersionEntry, tab: ResultTab): Promise<void> {
    const handler = getSubtypeHandler(tab.subtype)
    const ctx = buildCtx(tab)
    const configFiles = handler?.onHistoryTrigger?.({ type: "open", isNew: false }, ctx) ?? ["."]
    const files = await historyStore.getVersionFiles(entry.id, tab, configFiles)

    writingTabs.add(tab.id)
    try {
      if (handler?.applyVersionFiles) {
        await handler.applyVersionFiles(ctx, files)
      }
      callbacks.setCurrentVersionId(() => entry.id)
      callbacks.setFilesRefreshKey((k) => k + 1)
      const api = getDesktopApi()
      const stat = await api?.statFile?.(tab.filePath!)
      if (stat) {
        lastFileSize.set(tab.filePath!, stat.size)
      }
    } finally {
      writingTabs.delete(tab.id)
    }
  }

  async function onUserEdit(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    await trigger(tab, { type: "edit" }, "user")
    const api = getDesktopApi()
    const stat = await api?.statFile?.(tab.filePath!)
    if (stat) {
      lastFileSize.set(tab.filePath!, stat.size)
    }
  }

  /** 标记 tab 开始写文件（避免 agent 路径 B 误判） */
  function beginWrite(tabId: string): void {
    writingTabs.add(tabId)
  }

  /** 标记 tab 写文件结束 */
  function endWrite(tabId: string): void {
    writingTabs.delete(tabId)
  }

  async function onTabOpen(tab: ResultTab, existingBefore: ResultTab | undefined): Promise<void> {
    if (!isEligible(tab)) return
    const contentChanged = existingBefore && existingBefore.content !== tab.content
    if (!existingBefore) {
      await trigger(tab, { type: "open", isNew: true }, "init")
    } else if (contentChanged) {
      await trigger(tab, { type: "agent-update" }, "agent")
    }
    const api = getDesktopApi()
    const stat = await api?.statFile?.(tab.filePath!)
    if (stat) {
      lastFileSize.set(tab.filePath!, stat.size)
    }
  }

  async function onFileRefresh(tabs: ResultTab[]): Promise<void> {
    const api = getDesktopApi()
    for (const tab of tabs) {
      if (!isEligible(tab)) continue
      if (writingTabs.has(tab.id)) continue
      const stat = await api?.statFile?.(tab.filePath!)
      if (!stat) continue
      const prevSize = lastFileSize.get(tab.filePath!)
      lastFileSize.set(tab.filePath!, stat.size)
      if (prevSize === undefined) continue
      if (prevSize === stat.size) continue
      const buf = await api?.readFileBuffer?.(tab.filePath!)
      if (!buf) continue
      const fileContent = new TextDecoder().decode(buf)
      if (!fileContent) continue
      callbacks.updateTabContent(tab.id, fileContent)
      await trigger(tab, { type: "agent-file-edit" }, "agent")
    }
  }

  async function loadVersions(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    const list = await historyStore.listVersions(tab)
    callbacks.setVersionList(() => list)
    callbacks.setCurrentVersionId(() => list[0]?.id ?? null)
  }

  async function refreshVersions(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    const list = await historyStore.listVersions(tab)
    callbacks.setVersionList(() => list)
  }

  return {
    trigger,
    switchVersion,
    onUserEdit,
    onTabOpen,
    onFileRefresh,
    loadVersions,
    refreshVersions,
    listVersions: historyStore.listVersions,
    beginWrite,
    endWrite,
  }
}
