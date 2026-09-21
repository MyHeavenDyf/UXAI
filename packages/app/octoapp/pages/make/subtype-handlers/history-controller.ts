import { createHistoryStore, type VersionEntry, type HistoryActor, resolveRelativePath } from "../utils/history-store"
import { getSubtypeHandler } from "../utils/subtype-registry"
import { getSubtypeConfig } from "../utils/subtype-config"
import type { HistoryTriggerEvent, SubtypeHandlerContext } from "./types"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { getDesktopApi } from "../lib/electron-api"
import { showOctoToast } from "../components/octo-toast"
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
  isActiveTab: (id: string) => boolean
}

export function createHistoryController(callbacks: HistoryControllerCallbacks) {
  const historyStore = createHistoryStore()
  const writingTabs = new Set<string>()
  const lastFileHash = new Map<string, string>()
  // 版本列表代数：loadVersions/refreshVersions 完成后校验，防止过期的磁盘快照覆盖新记录
  let listGeneration = 0

  /** 读文件并算 hash */
  async function getFileHash(filePath: string): Promise<string | null> {
    const api = getDesktopApi()
    const buf = await api?.readFileBuffer?.(filePath)
    if (!buf) return null
    return fnv1aHash(buf)
  }

  /** 取 tab 关联的全部文件相对路径（由 subtype handler 决定）。
   *  default 只关心 HTML 自身（"."），prototype 关心 a2ui-data 下各 .json（+孪生）或旧页 data.js。
   *  这样 onFileRefresh 能检测到 agent 对 A2UI 数据文件的修改（HTML 不变时也能触发）。 */
  async function getTabFiles(tab: ResultTab): Promise<string[]> {
    const handler = getSubtypeHandler(tab.subtype)
    const ctx = buildCtx(tab)
    return (await handler?.onHistoryTrigger?.({ type: "agent-file-edit" }, ctx)) ?? ["."]
  }

  /** 计算 tab 关联的所有文件的合并 hash。
   *  把每个文件的 hash 用 "|" 拼接，任一文件变化都会改变合并 hash。 */
  async function getTabFileSetHash(tab: ResultTab): Promise<string | null> {
    if (!tab.filePath) return null
    const files = await getTabFiles(tab)
    if (!files || files.length === 0) return null
    const hashes: string[] = []
    for (const rel of files) {
      const filePath = resolveRelativePath(rel, tab.filePath)
      const h = await getFileHash(filePath)
      if (h) hashes.push(h)
    }
    return hashes.length > 0 ? hashes.join("|") : null
  }

  function buildCtx(tab: ResultTab): SubtypeHandlerContext {
    return {
      tab,
      showOctoToast,
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
    // fastui:// 是预览卡片的产物身份,不是磁盘文件(SPEC-DES-004)
    if (tab.type === "link" || tab.filePath.startsWith("http") || tab.filePath.startsWith("fastui://")) return false
    return true
  }

  async function trigger(tab: ResultTab, event: HistoryTriggerEvent, actor: HistoryActor): Promise<void> {
    if (!isEligible(tab)) return
    const handler = getSubtypeHandler(tab.subtype)
    const ctx = buildCtx(tab)
    const files = await handler?.onHistoryTrigger?.(event, ctx)
    if (!files || files.length === 0) return

    if (event.type === "open" && event.isNew) {
      const existing = await historyStore.listVersions(tab)
      if (existing.length > 0) {
        callbacks.setCurrentVersionId(() => existing[0]?.id ?? null)
        return
      }
    }

    // 同内容同 actor 去重：一次模型编辑会并发触发多路事件（file.edited / watcher /
    // tool.success / step.ended / onFilesRefresh，可能再加路径 A），每路都可能走到
    // recordVersion；若最新版本已由同一 actor 记录且内容一致，跳过本次记录。
    if (actor !== "init") {
      const existing = await historyStore.listVersions(tab)
      const newest = existing[0]
      if (newest && newest.actor === actor) {
        const currentHash = await getTabFileSetHash(tab)
        const versionFiles = await historyStore.getVersionFiles(newest.id, tab, files)
        const hashes: string[] = []
        for (const vf of versionFiles) {
          const h = await getFileHash(vf.filePath)
          if (h) hashes.push(h)
        }
        if (currentHash && hashes.join("|") === currentHash) {
          callbacks.setCurrentVersionId(() => newest.id)
          return
        }
      }
    }

    const entry = await historyStore.recordVersion(tab, actor, files, getSubtypeConfig(tab.subtype).history?.maxVersions)
    if (entry) {
      // 使进行中的 loadVersions/refreshVersions 失效（它们的快照可能不含本条记录）
      listGeneration++
      if (callbacks.isActiveTab(tab.id)) {
        // 激活 tab：重拉磁盘列表，自愈任何过期快照
        const list = await historyStore.listVersions(tab)
        callbacks.setVersionList(() => list)
        callbacks.setCurrentVersionId(() => entry.id)
      } else {
        callbacks.setVersionList((prev) => [entry, ...prev])
      }
    }
  }

  async function switchVersion(entry: VersionEntry, tab: ResultTab): Promise<void> {
    const handler = getSubtypeHandler(tab.subtype)
    const ctx = buildCtx(tab)
    const configFiles = (await handler?.onHistoryTrigger?.({ type: "open", isNew: false }, ctx)) ?? ["."]
    const files = await historyStore.getVersionFiles(entry.id, tab, configFiles)

    writingTabs.add(tab.id)
    try {
      if (handler?.applyVersionFiles) {
        await handler.applyVersionFiles(ctx, files)
      }
      callbacks.setCurrentVersionId(() => entry.id)
      callbacks.setFilesRefreshKey((k) => k + 1)
      const hash = await getTabFileSetHash(tab)
      if (hash) {
        lastFileHash.set(tab.filePath!, hash)
      }
    } finally {
      writingTabs.delete(tab.id)
    }
  }

  async function onUserEdit(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    /** 内容未变守卫：当前文件集 hash 与上次记录/同步基线一致（空提交、同一编辑的重复派发）时
     *  不再记 user 版本——recordVersion 无内容去重，同一分钟内两条会产生"内容与时间都一样"的重复记录 */
    const hash = await getTabFileSetHash(tab)
    if (hash && hash === lastFileHash.get(tab.filePath!)) return
    await trigger(tab, { type: "edit" }, "user")
    if (hash) {
      lastFileHash.set(tab.filePath!, hash)
    }
  }

  /** 仅刷新 tab 关联文件的合并 hash 基线，不记录版本。
   *  用于 prototype 状态同步落盘（非用户编辑）：persist 写了 a2ui-data 但不该产生 user 版本，
   *  此处把 lastFileHash 推进到写后值，避免随后 onFileRefresh 把这次写入误记为 agent 编辑。 */
  async function syncFileHash(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    const hash = await getTabFileSetHash(tab)
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
    const hash = await getTabFileSetHash(tab)
    if (hash) {
      lastFileHash.set(tab.filePath!, hash)
    }
  }

  // onFileRefresh 串行化：一次模型编辑会并发触发多路事件，若并发执行，
  // 各调用可能读到写入中间态的 hash（或基线读写交错），导致一次编辑记多条版本。
  // 在途时只置 pending 标记，当前轮跑完后补跑一轮（合并突发事件）。
  let refreshInFlight = false
  let refreshQueued = false
  let refreshQueuedTurnEnd = false

  // 'turn' 模式的静默期结算：轮内变化后若 SETTLE_DELAY_MS 内无新事件，
  // 自动补一次 turnEnd 记录。不依赖 turnEnd 事件时序——session.idle 可能赶在
  // 文件写入完成前到达（此时 hash==基线被跳过），之后的 file.edited 已无 turnEnd，
  // 改动会被永久搁置（表现为"停在原始版本/没有模型编辑记录"）。
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const SETTLE_DELAY_MS = 1500

  function scheduleSettle(tabs: ResultTab[]): void {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      void onFileRefresh(tabs, { turnEnd: true })
    }, SETTLE_DELAY_MS)
  }

  async function onFileRefresh(tabs: ResultTab[], opts?: { turnEnd?: boolean }): Promise<void> {
    if (refreshInFlight) {
      refreshQueued = true
      if (opts?.turnEnd) refreshQueuedTurnEnd = true
      return
    }
    refreshInFlight = true
    try {
      do {
        const turnEnd = !!opts?.turnEnd || refreshQueuedTurnEnd
        refreshQueued = false
        refreshQueuedTurnEnd = false
        for (const tab of tabs) {
          if (!isEligible(tab)) continue
          if (writingTabs.has(tab.id)) continue
          const hash = await getTabFileSetHash(tab)
          if (!hash) continue
          const prevHash = lastFileHash.get(tab.filePath!)
          if (prevHash === undefined) {
            // 首次见到：只建基线，不记录
            lastFileHash.set(tab.filePath!, hash)
            continue
          }
          if (prevHash === hash) continue
          const coalesce = getSubtypeConfig(tab.subtype).history?.agentTurnRecord === "turn" && !turnEnd
          const api = getDesktopApi()
          if (coalesce) {
            // agent 轮内：只同步内存内容 + 刷新预览，不推进基线、不记录。
            // 安排静默期结算：1.5s 内无新事件（或到达 turnEnd）时记一条，
            // 避免依赖 turnEnd 事件时序导致改动被永久搁置。
            scheduleSettle(tabs)
            const buf = await api?.readFileBuffer?.(tab.filePath!)
            if (!buf) continue
            const fileContent = new TextDecoder().decode(buf)
            if (fileContent && fileContent !== tab.content) {
              callbacks.updateTabContent(tab.id, fileContent)
              callbacks.setFilesRefreshKey((k) => k + 1)
            }
            continue
          }
          // 记录路径（turnEnd 或 'each' 模式）：推进基线 + 记录
          if (settleTimer) {
            clearTimeout(settleTimer)
            settleTimer = undefined
          }
          lastFileHash.set(tab.filePath!, hash)
          const buf = await api?.readFileBuffer?.(tab.filePath!)
          if (!buf) continue
          const fileContent = new TextDecoder().decode(buf)
          if (!fileContent) continue
          if (fileContent !== tab.content) {
            callbacks.updateTabContent(tab.id, fileContent)
          }
          await trigger(tab, { type: "agent-file-edit" }, "agent")
          callbacks.setFilesRefreshKey((k) => k + 1)
        }
      } while (refreshQueued)
    } finally {
      refreshInFlight = false
    }
  }

  async function loadVersions(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    const seq = ++listGeneration
    const list = await historyStore.listVersions(tab)
    if (seq !== listGeneration) return
    callbacks.setVersionList(() => list)
    const currentHash = await getTabFileSetHash(tab)
    let currentId = list[0]?.id ?? null
    if (currentHash && list.length > 0) {
      const matched = await findVersionByHash(tab, list, currentHash)
      if (matched) currentId = matched.id
    }
    if (seq !== listGeneration) return
    callbacks.setCurrentVersionId(() => currentId)
    if (currentHash) {
      lastFileHash.set(tab.filePath!, currentHash)
    }
  }

  /** 对比 tab 当前合并 hash 和各版本同文件集的合并 hash，找匹配的版本 */
  async function findVersionByHash(tab: ResultTab, list: VersionEntry[], targetHash: string): Promise<VersionEntry | null> {
    const files = await getTabFiles(tab)
    for (const entry of list) {
      const versionFiles = await historyStore.getVersionFiles(entry.id, tab, files)
      const hashes: string[] = []
      for (const vf of versionFiles) {
        const h = await getFileHash(vf.filePath)
        if (h) hashes.push(h)
      }
      const combinedHash = hashes.join("|")
      if (combinedHash === targetHash) return entry
    }
    return null
  }

  async function refreshVersions(tab: ResultTab): Promise<void> {
    if (!isEligible(tab)) return
    const seq = ++listGeneration
    const list = await historyStore.listVersions(tab)
    if (seq !== listGeneration) return
    callbacks.setVersionList(() => list)
  }

  return {
    trigger,
    switchVersion,
    onUserEdit,
    syncFileHash,
    onTabOpen,
    onFileRefresh,
    loadVersions,
    refreshVersions,
    listVersions: historyStore.listVersions,
    beginWrite,
    endWrite,
  }
}
