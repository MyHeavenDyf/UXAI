import { createHistoryStore, type VersionEntry, type HistoryActor } from "../utils/history-store"
import { getSubtypeHandler } from "../utils/subtype-registry"
import type { HistoryTriggerEvent, SubtypeHandlerContext } from "./types"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { getDesktopApi } from "../lib/electron-api"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"

const HISTORY_SKIP_TYPES = ["image", "video", "audio", "pdf", "svg", "text", "local-file"]

/** FNV-1a hash：同步、纯 JS，对短文本足够精确 */
function fnv1aHash(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16)
}

export interface HistoryControllerCallbacks {
  setVersionList: (updater: (prev: VersionEntry[]) => VersionEntry[]) => void
  setCurrentVersionId: (updater: (prev: string | null) => string | null) => void
  updateTabContent: (id: string, content: string) => void
  setFilesRefreshKey: (updater: (prev: number) => number) => void
}

export function createHistoryController(callbacks: HistoryControllerCallbacks) {
  const historyStore = createHistoryStore()
  const writingTabs = new Set<string>()
  const lastFileHash = new Map<string, string>()

  /** 读文件并算 hash */
  async function getFileHash(filePath: string): Promise<string | null> {
    const api = getDesktopApi()
    const buf = await api?.readFileBuffer?.(filePath)
    if (!buf) return null
    return fnv1aHash(buf)
  }

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
      usePixsoTransport: async () => ({ uploadResult: { webview: null }, actions: [] }),
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
      const hash = await getFileHash(tab.filePath!)
      if (hash) {
        lastFileHash.set(tab.filePath!, hash)
      }
    } finally {
      writingTabs.delete(tab.id)
    }
  }

  async function onUserEdit(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    await trigger(tab, { type: "edit" }, "user")
    const hash = await getFileHash(tab.filePath!)
    if (hash) {
      lastFileHash.set(tab.filePath!, hash)
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
    const hash = await getFileHash(tab.filePath!)
    if (hash) {
      lastFileHash.set(tab.filePath!, hash)
    }
  }

  async function onFileRefresh(tabs: ResultTab[]): Promise<void> {
    for (const tab of tabs) {
      if (!isEligible(tab)) continue
      if (writingTabs.has(tab.id)) continue
      const hash = await getFileHash(tab.filePath!)
      if (!hash) continue
      const prevHash = lastFileHash.get(tab.filePath!)
      lastFileHash.set(tab.filePath!, hash)
      if (prevHash === undefined) continue
      if (prevHash === hash) continue
      const api = getDesktopApi()
      const buf = await api?.readFileBuffer?.(tab.filePath!)
      if (!buf) continue
      const fileContent = new TextDecoder().decode(buf)
      if (!fileContent) continue
      callbacks.updateTabContent(tab.id, fileContent)
      await trigger(tab, { type: "agent-file-edit" }, "agent")
      callbacks.setFilesRefreshKey((k) => k + 1)
    }
  }

  async function loadVersions(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    const list = await historyStore.listVersions(tab)
    callbacks.setVersionList(() => list)
    const currentHash = await getFileHash(tab.filePath!)
    let currentId = list[0]?.id ?? null
    if (currentHash && list.length > 0) {
      const matched = await findVersionByHash(tab, list, currentHash)
      if (matched) currentId = matched.id
    }
    callbacks.setCurrentVersionId(() => currentId)
    if (currentHash) {
      lastFileHash.set(tab.filePath!, currentHash)
    }
  }

  /** 对比文件 hash 和各版本 self 文件 hash，找匹配的版本 */
  async function findVersionByHash(tab: ResultTab, list: VersionEntry[], targetHash: string): Promise<VersionEntry | null> {
    for (const entry of list) {
      const files = await historyStore.getVersionFiles(entry.id, tab, ["."])
      const selfFile = files.find(f => f.fileName.startsWith("self."))
      if (!selfFile) continue
      const hash = await getFileHash(selfFile.filePath)
      if (hash === targetHash) return entry
    }
    return null
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
