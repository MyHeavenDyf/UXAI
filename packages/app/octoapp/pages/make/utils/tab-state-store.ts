import type { ResultTab } from "../components/result-viewer/tab-store"

/**
 * 每 session 的 ResultViewer tab 状态持久化(localStorage)。
 * 切换 session / 页面卸载(Make→Insight 等) / 刷新后,重新进入同一 session 时恢复 tabs。
 *
 * 内容策略:
 * - 无 filePath 的 tab(react-component/diagram 等纯内存内容)内联 content,受单 tab 上限约束
 * - 有 filePath 的 tab 只存元数据,恢复后由调用方从磁盘(/file/content)异步水合
 * - design-plan 不纳入:走独立 plan 流程(persistActivePlanDraft + 历史版本面板)
 */

const TAB_STATE_PREFIX = "octo:make:tabs:"
const MAX_PERSISTED_TABS = 20
const MAX_INLINE_CONTENT_CHARS = 128 * 1024

export interface PersistedTabState {
  tabs: ResultTab[]
  activeId: string | null
}

type SerializedTab = Omit<ResultTab, "createdAt"> & { createdAt: string }

type SerializedState = {
  version: 1
  savedAt: number
  activeId: string | null
  tabs: SerializedTab[]
}

function storageKey(sessionId: string): string {
  return TAB_STATE_PREFIX + sessionId
}

function isPersistable(tab: ResultTab): boolean {
  return tab.type !== "design-plan"
}

function serializeTab(tab: ResultTab): SerializedTab {
  const inlineContent = !tab.filePath && tab.content.length <= MAX_INLINE_CONTENT_CHARS ? tab.content : ""
  return { ...tab, content: inlineContent, createdAt: tab.createdAt.toISOString() }
}

function deserializeTab(entry: SerializedTab): ResultTab | null {
  if (!entry?.id || !entry?.type) return null
  const createdAt = new Date(entry.createdAt)
  if (Number.isNaN(createdAt.getTime())) return null
  return { ...entry, createdAt }
}

function writeState(sessionId: string, state: SerializedState): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(state))
  } catch {
    // 配额不足:降级去掉内联内容重试,仍失败则放弃本次保存(下次 mutation 会再尝试)
    try {
      const stripped = state.tabs.map((t) => ({ ...t, content: "" }))
      localStorage.setItem(storageKey(sessionId), JSON.stringify({ ...state, tabs: stripped }))
    } catch {
      console.warn("[TabStateStore] save failed (quota exceeded)", sessionId)
    }
  }
}

export function saveSessionTabs(sessionId: string, tabs: ResultTab[], activeId: string | null): void {
  const persistableTabs = tabs.filter(isPersistable)
  // 超上限时按 lastActivatedAt 保留最近访问的 tab,activeId 始终保留
  const keepIds = new Set(
    persistableTabs
      .slice()
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))
      .slice(0, MAX_PERSISTED_TABS)
      .map((t) => t.id),
  )
  if (activeId) keepIds.add(activeId)
  const kept = persistableTabs.filter((t) => keepIds.has(t.id))
  writeState(sessionId, {
    version: 1,
    savedAt: Date.now(),
    activeId,
    tabs: kept.map(serializeTab),
  })
}

export function loadSessionTabs(sessionId: string): PersistedTabState | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(storageKey(sessionId))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SerializedState
    if (parsed?.version !== 1 || !Array.isArray(parsed.tabs)) return null
    const tabs = parsed.tabs.flatMap((t) => {
      const restored = deserializeTab(t)
      return restored ? [restored] : []
    })
    if (tabs.length === 0) return { tabs: [], activeId: null }
    const activeId = tabs.some((t) => t.id === parsed.activeId) ? (parsed.activeId as string) : null
    return { tabs, activeId }
  } catch {
    return null
  }
}

export function clearSessionTabs(sessionId: string): void {
  try {
    localStorage.removeItem(storageKey(sessionId))
  } catch {
    // ignore
  }
}
