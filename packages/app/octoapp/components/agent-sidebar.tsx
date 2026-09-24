import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogDeleteSession } from "@/components/dialog-delete-session"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
// useGlobalSync is currently unused; re-enable when sync-specific hooks are needed
// import { useGlobalSync } from "@/context/global-sync"
import { sessionTitle } from "@/utils/session-title"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { tracker } from "@/utils/tracker"
import { pickNextSession } from "@/utils/session-delete"
import { useSessionDelete } from "@/hooks/use-session-delete"
import { useSessionPin } from "@/hooks/use-session-pin"
// disableIframesDuringDrag is currently unused after recent refactors
// import { disableIframesDuringDrag } from "@/utils/iframe-drag"
import { SidebarShell, SidebarSectionHeader } from "@/components/sidebar-shell"
import { SessionList } from "@/components/session-list"
import { SessionContextMenu } from "@/components/session-context-menu"

export type SidebarGroup = { id: string; name: string }

export type SessionDropTarget =
  | { type: "session"; sessionId: string; position: "before" | "after"; section: "pinned" | "recent" | "group"; groupId?: string }
  | { type: "section"; section: "pinned" | "recent" }
  | { type: "group"; groupId: string }

export type BeforeSectionApi = {
  sessions: Session[]
  onSessionClick: (s: Session) => void
  onSessionContextMenu: (s: Session, e: MouseEvent) => void
  activeSessionId: () => string | undefined
  isContextTarget: (s: Session) => boolean
  isPinned: (s: Session) => boolean
  renamingId: () => string | null
  renameDraft: () => string
  onRenameInput: (v: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  stable: () => boolean
  deleteSessions: (sessions: Session[]) => Promise<void>
  draggingSessionId: () => string | null
  dragOverSessionId: () => string | null
  sessionDropPosition: () => "before" | "after" | null
  onSessionDragStart: (session: Session) => void
  onSessionDragEnd: () => void
  onSessionDragOver: (e: DragEvent, session: Session) => void
  onSessionDragLeave: (e: DragEvent, session: Session) => void
  handleSessionDrop: (target: SessionDropTarget) => void
}

export type AgentSidebarProps = {
  // ── Data ──
  /** Current project directory. Caller is responsible for resolving this. */
  directory: string | null | undefined
  /** Agent string to filter sessions by */
  agentFilter: string
  /** Custom list params passed to client.session.list() */
  listParams?: Record<string, unknown>
  /** Custom session fetcher. When provided, replaces the default client.session.list() call.
   *  Should return ALL sessions for the directory; AgentSidebar handles sort/filter/pagination. */
  fetchSessions?: (directory: string) => Promise<Session[]>
  /** Server-side pagination fetcher. When provided, AgentSidebar fetches one page at a time
   *  on scroll instead of loading all sessions upfront. The cursor is an opaque string whose
   *  meaning is defined by the implementation (e.g. composite cursor for cursor-based APIs,
   *  offset for offset-based APIs). Return nextCursor=undefined when there are no more pages. */
  fetchSessionPage?: (directory: string, cursor?: string) => Promise<{ sessions: Session[], nextCursor?: string }>
  /** Optional fetcher for pinned sessions. When provided, the returned sessions are merged into
   *  the list on first load so pinned sessions remain visible even if their update time is old.
   *  If omitted, AgentSidebar will not fetch pinned sessions separately. */
  fetchPinnedSessions?: (directory: string) => Promise<Session[]>
  /** Optional fetcher for sessions that belong to a group. When provided, the returned sessions are merged into
   *  the list on first load so group sessions are available immediately without scroll-loading. */
  fetchGroupSessions?: (directory: string) => Promise<Session[]>
  /** Optional fetcher for a single session by ID. Used to backfill the current active session
   *  when it is not included in the first page (e.g. deep-linked old sessions). */
  fetchSessionById?: (directory: string, sessionID: string) => Promise<Session | null | undefined>

  // ── Routes ──
  /** Build URL for an existing session */
  buildSessionRoute: (session: Session) => string
  /** Build URL for "new session" (lazy navigate) */
  buildNewRoute: () => string
  /** Build URL after deleting active session. Receives the deleted session. */
  buildDeleteFallback: (session: Session) => string
  /** Extract active session ID from current URL. Return undefined if none. */
  activeSessionId: () => string | undefined

  // ── UI ──
  sectionTitle: string
  sectionIcon?: () => JSX.Element
  newButtonText?: string
  trackerModule?: string
  /** Rendered above the main section. Receives the full session list and handlers so callers can render grouped sessions. */
  beforeSection?: (api: BeforeSectionApi) => JSX.Element
  inlineBeforeSection?: boolean

  /** Called when a session is clicked, before navigation. Useful for parent components to react to clicks even when the URL does not change. */
  onSessionClick?: (session: Session) => void
  /** Called after scrolling reveals more recent sessions. */
  onLoadMore?: (limit: number) => void

  // ── Groups (optional, for make/design) ──
  /** Available groups. When provided, the context menu shows a "移动到分组" submenu. */
  groups?: SidebarGroup[]
  /** Session-to-group mapping (sessionId -> { groupId, position }). Sessions with a mapping are excluded from "最近". */
  sessionGroupMapping?: Record<string, { groupId: string; position: number }>
  /** Called when the user selects a group in the "移动到分组" submenu. */
  onMoveToGroup?: (session: Session, groupId: string) => Promise<void> | void
  /** Called when the user clicks "移出此分组" in the context menu. */
  onRemoveFromGroup?: (session: Session) => void
  /** Called when the user clicks "新建分组" in the "移动到分组" submenu. Implementations should open the create-group dialog, then move the current session into the newly created group. */
  onCreateGroupForSession?: (session: Session) => void
  /** Called when a session is reordered within a group via DnD. */
  onReorderGroupSessions?: (groupId: string, sourceId: string, targetId: string, position: "before" | "after") => Promise<void> | void

  // ── UI toggles ──
  showProjectInfo?: boolean
  showBottomNav?: boolean

  // ── Settings (optional) ──
  showSettings?: boolean
  onSettingsClick?: () => void

  // ── Nav (optional) ──
  sidebarSourceKey?: "cowork" | "make" | "insight"
  /** Custom handler for skill button click. If provided, overrides default navigation to /skills. */
  onSkillClick?: () => void
  /** When true, highlights the skill button (for inline panel mode). */
  skillsActive?: boolean
}

// Module-level cache: AgentSidebar unmounts on every route switch (design↔insight),
// and createResource is per-instance — without caching, each remount fires
// fetchSessionPage + fetchPinnedSessions + fetchGroupSessions (3 requests) even
// when nothing changed. This seeds the fetcher from the last result within
// SIDEBAR_STALE_MS so rapid tab toggling (no session events between) is free.
// Bust on SSE session events / explicit refetch so stale data never lingers.
const SIDEBAR_STALE_MS = 30_000
const SIDEBAR_CACHE_MAX = 8
const sidebarCache = new Map<string, { sessions: Session[]; cursor?: string; at: number }>()

function writeSidebarCache(key: string, value: { sessions: Session[]; cursor?: string; at: number }) {
  sidebarCache.set(key, value)
  if (sidebarCache.size <= SIDEBAR_CACHE_MAX) return
  const oldest = [...sidebarCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
  if (oldest) sidebarCache.delete(oldest[0])
}

export function AgentSidebar(props: AgentSidebarProps) {
  const globalSDK = useGlobalSDK()
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const layout = useLayout()
  const language = useLanguage()
  const removeSession = useSessionDelete()

  const resolvedDir = () => props.directory ?? undefined
  const [fetchedDir, setFetchedDir] = createSignal<string>()

  const isOnboarding = createMemo(() => !resolvedDir())

  // Declared before createResource: the fetcher runs synchronously up to its
  // first await, and the cache-hit branch calls setSessionCursor synchronously.
  const [sessionCursor, setSessionCursor] = createSignal<string | undefined>(undefined)

  const [sessions, { refetch: refetchResource }] = createResource(
    () => isOnboarding() ? "" : (resolvedDir() ?? ""),
    async (d: string) => {
      if (!d) {
        setFetchedDir(d)
        return [] as Session[]
      }
      const cacheKey = `${props.agentFilter}\n${d}`
      const cached = sidebarCache.get(cacheKey)
      if (cached && Date.now() - cached.at < SIDEBAR_STALE_MS) {
        setSessionCursor(cached.cursor)
        setFetchedDir(d)
        return cached.sessions
      }
      try {
        if (props.fetchSessionPage) {
          const [result, pinned, grouped] = await Promise.all([
            props.fetchSessionPage(d),
            props.fetchPinnedSessions ? props.fetchPinnedSessions(d) : Promise.resolve([] as Session[]),
            props.fetchGroupSessions ? props.fetchGroupSessions(d) : Promise.resolve([] as Session[]),
          ])
          if (resolvedDir() !== d) return [] as Session[]
          setSessionCursor(result.nextCursor)
          const pinnedIds = new Set(pinned.map(s => s.id))
          const groupedDeduped = grouped.filter(s => !pinnedIds.has(s.id))
          const existingIds = new Set([...pinnedIds, ...groupedDeduped.map(s => s.id)])
          const sorted = result.sessions
            .filter(s => !existingIds.has(s.id))
            .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
          const merged = [...pinned, ...groupedDeduped, ...sorted].filter(s => s.agent === props.agentFilter)
          writeSidebarCache(cacheKey, { sessions: merged, cursor: result.nextCursor, at: Date.now() })
          setFetchedDir(d)
          return merged
        }
        const data = props.fetchSessions
          ? await props.fetchSessions(d)
          : ((await globalSDK.createClient({ directory: d }).session.list(props.listParams as any)).data ?? []) as Session[]
        const sorted = data.sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
        const merged = sorted.filter(s => s.agent === props.agentFilter)
        writeSidebarCache(cacheKey, { sessions: merged, cursor: undefined, at: Date.now() })
        setFetchedDir(d)
        return merged
      } catch (err) {
        if (resolvedDir() !== d) return [] as Session[]
        setFetchedDir(d)
        console.error("[agent-sidebar] session fetch failed", { dir: d, error: String(err) })
        return [] as Session[]
      }
    },
  )

  // Bust the per-directory sidebar cache. Called on SSE session events and every
  // explicit refetch so the fetcher always hits the network when data may have changed.
  const bustSidebarCache = () => {
    const d = resolvedDir()
    if (d) sidebarCache.delete(`${props.agentFilter}\n${d}`)
  }
  // Wrap refetch to bust cache first — without this, refetch() would serve stale
  // cache instead of re-requesting from the server.
  const refetch = () => { bustSidebarCache(); return refetchResource() }

  const [sessionList, setSessionList] = createStore<Session[]>([])
  const [loadingMoreSessions, setLoadingMoreSessions] = createSignal(false)
  const useServerPagination = () => !!props.fetchSessionPage
  const [pinnedCollapsed, setPinnedCollapsed] = createSignal(false)

  const [draggingSessionId, setDraggingSessionId] = createSignal<string | null>(null)
  const [dragOverSessionId, setDragOverSessionId] = createSignal<string | null>(null)
  const [sessionDropPosition, setSessionDropPosition] = createSignal<"before" | "after" | null>(null)
  let restoreIframes: (() => void) | undefined
  let scrollContainer: HTMLDivElement | undefined

  const pinnedSessions = createMemo(() =>
    sessionList.filter(s => s.pinned).sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
  )
  const recentSessions = createMemo(() =>
    sessionList
      .filter(s => !s.pinned && !props.sessionGroupMapping?.[s.id])
      .sort((a, b) => {
        const sa = Number(a.sort_order), sb = Number(b.sort_order)
        if (sa !== sb) return sa - sb
        return (b.time.updated ?? 0) - (a.time.updated ?? 0)
      })
  )

  const VISIBLE_BATCH = 30
  const [visibleCount, setVisibleCount] = createSignal(VISIBLE_BATCH)
  const displayedRecentSessions = createMemo(() =>
    useServerPagination() ? recentSessions() : recentSessions().slice(0, visibleCount())
  )
  const hasMoreSessions = createMemo(() =>
    useServerPagination() ? sessionCursor() !== undefined : visibleCount() < recentSessions().length
  )

  const loadMoreFromServer = async (fromScroll = false) => {
    if (loadingMoreSessions() || sessionCursor() === undefined) return
    const d = resolvedDir()
    if (!d || !props.fetchSessionPage) return
    tracker.interaction({ module: props.trackerModule ?? "session", name: "load-more-sessions" })
    setLoadingMoreSessions(true)
    try {
      let cursor = sessionCursor()
      let emptyPages = 0
      let loadedAny = false
      while (cursor !== undefined && emptyPages < 10) {
        const result = await props.fetchSessionPage(d, cursor)
        if (resolvedDir() !== d) return
        setSessionCursor(result.nextCursor)
        cursor = result.nextCursor
        const sorted = result.sessions.sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
        const filtered = sorted.filter(s => s.agent === props.agentFilter)
        const existingIds = new Set(sessionList.map(s => s.id))
        const deduped = filtered.filter(s => !existingIds.has(s.id))
        if (deduped.length > 0) {
          const previousRecentCount = recentSessions().length
          setSessionList(produce((draft) => { draft.push(...deduped) }))
          if (fromScroll && recentSessions().length > previousRecentCount) props.onLoadMore?.(recentSessions().length)
          loadedAny = true
          break
        }
        emptyPages++
      }
      if (!loadedAny) setSessionCursor(undefined)
    } catch (err) {
      console.error("[agent-sidebar] loadMoreFromServer failed", { dir: d, error: String(err) })
    } finally {
      setLoadingMoreSessions(false)
    }
  }

  createEffect(on(resolvedDir, () => { setVisibleCount(VISIBLE_BATCH); setSessionCursor(undefined) }, { defer: true }))

  createEffect(on(displayedRecentSessions, () => {
    requestAnimationFrame(() => {
      if (!scrollContainer || !scrollContainer.clientHeight) return
      if (hasMoreSessions() && scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
        if (useServerPagination()) void loadMoreFromServer()
        else setVisibleCount(prev => prev + VISIBLE_BATCH)
      }
    })
  }))

  const { togglePin: togglePinSession } = useSessionPin()

  async function togglePin(id: string) {
    const idx = sessionList.findIndex(s => s.id === id)
    if (idx < 0) return
    const session = sessionList[idx]
    const d = resolvedDir()
    if (!d) return
    const newVal = !session.pinned
    tracker.interaction({ module: props.trackerModule ?? "session", name: newVal ? "pin-session" : "unpin-session" })
    const previousSortOrder = session.sort_order
    if (newVal) {
      batch(() => {
        setSessionList(idx, "sort_order", -1)
        setSessionList(idx, "pinned", true)
      })
    } else {
      batch(() => {
        setSessionList(idx, "pinned", false)
        setSessionList(idx, "sort_order", session.time.updated)
      })
    }
    bustSidebarCache()
    try {
      await togglePinSession(id, newVal, d, !newVal ? session.time.updated : undefined)
    } catch (err) {
      // Revert optimistic update on failure
      batch(() => {
        setSessionList(idx, "pinned", !newVal)
        setSessionList(idx, "sort_order", previousSortOrder)
      })
      throw err
    }
  }

  async function reorderPinned(sourceId: string, targetId: string, position: "before" | "after") {
    const ids = pinnedSessions().map(s => s.id).filter(id => id !== sourceId)
    const targetIdx = ids.indexOf(targetId)
    if (targetIdx === -1) return
    ids.splice(position === "before" ? targetIdx : targetIdx + 1, 0, sourceId)
    ids.forEach((id, i) => {
      const idx = sessionList.findIndex(s => s.id === id)
      if (idx >= 0) setSessionList(idx, "sort_order", i)
    })
    const d = resolvedDir()
    if (!d) return
    bustSidebarCache()
    const client = globalSDK.createClient({ directory: d })
    await client.session.reorder({ ids })
  }

  async function reorderRecent(sourceId: string, targetId: string, position: "before" | "after") {
    const ids = recentSessions().map(s => s.id).filter(id => id !== sourceId)
    const targetIdx = ids.indexOf(targetId)
    if (targetIdx === -1) { ids.push(sourceId) } else {
      ids.splice(position === "before" ? targetIdx : targetIdx + 1, 0, sourceId)
    }
    ids.forEach((id, i) => {
      const idx = sessionList.findIndex(s => s.id === id)
      if (idx >= 0) setSessionList(idx, "sort_order", i)
    })
    const d = resolvedDir()
    if (!d) return
    bustSidebarCache()
    const client = globalSDK.createClient({ directory: d })
    await client.session.reorder({ ids })
  }

  function handleSessionDragStart(session: Session) {
    const frames = [...document.querySelectorAll("iframe")]
    const saved = frames.map((f) => f.style.pointerEvents)
    frames.forEach((f) => (f.style.pointerEvents = "none"))
    restoreIframes = () => { frames.forEach((f, i) => (f.style.pointerEvents = saved[i])) }
    setTimeout(() => setDraggingSessionId(session.id), 0)
  }

  function handleSessionDragEnd() {
    setDraggingSessionId(null)
    setDragOverSessionId(null)
    setSessionDropPosition(null)
    restoreIframes?.()
    restoreIframes = undefined
  }

  function handleSessionDragOver(e: DragEvent, session: Session) {
    if (!draggingSessionId() || draggingSessionId() === session.id) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDragOverSessionId(session.id)
    setSessionDropPosition(e.clientY - rect.top < rect.height / 2 ? "before" : "after")
  }

  function handleSessionDragLeave(e: DragEvent, session: Session) {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as HTMLElement).contains(related)) return
    if (dragOverSessionId() === session.id) setDragOverSessionId(null)
  }

  async function performSessionMove(target: SessionDropTarget) {
    const mod = props.trackerModule ?? "session"
    const sourceId = draggingSessionId()
    if (!sourceId) { handleSessionDragEnd(); return }
    const source = sessionList.find(s => s.id === sourceId)
    if (!source) { handleSessionDragEnd(); return }

    const sourceIsPinned = !!source.pinned
    const sourceGroup = props.sessionGroupMapping?.[sourceId]?.groupId

    if (target.type === "session") {
      const { sessionId: targetId, position, section, groupId } = target
      if (sourceId === targetId) { handleSessionDragEnd(); return }
      if (section === "pinned") {
        if (!sourceIsPinned) {
          if (sourceGroup) props.onRemoveFromGroup?.(source)
          void togglePin(sourceId)
        }
        tracker.interaction({ module: mod, name: "reorder-pinned-session" })
        void reorderPinned(sourceId, targetId, position)
      } else if (section === "recent") {
        if (sourceIsPinned) void togglePin(sourceId)
        if (sourceGroup) props.onRemoveFromGroup?.(source)
        tracker.interaction({ module: mod, name: "reorder-recent-session" })
        void reorderRecent(sourceId, targetId, position)
      } else if (section === "group" && groupId) {
        if (sourceIsPinned) void togglePin(sourceId)
        if (sourceGroup !== groupId) {
          tracker.interaction({ module: mod, name: "drag-session-to-group" })
          await props.onMoveToGroup?.(source, groupId)
        } else {
          tracker.interaction({ module: mod, name: "reorder-group-session" })
        }
        props.onReorderGroupSessions?.(groupId, sourceId, targetId, position)
      }
    } else if (target.type === "section") {
      if (target.section === "pinned") {
        if (!sourceIsPinned) {
          if (sourceGroup) props.onRemoveFromGroup?.(source)
          void togglePin(sourceId)
        }
        tracker.interaction({ module: mod, name: "drag-session-to-pinned" })
      } else if (target.section === "recent") {
        if (sourceIsPinned) void togglePin(sourceId)
        if (sourceGroup) props.onRemoveFromGroup?.(source)
        tracker.interaction({ module: mod, name: "drag-session-to-recent" })
      }
    } else if (target.type === "group" && target.groupId) {
      if (sourceIsPinned) void togglePin(sourceId)
      if (sourceGroup !== target.groupId) {
        tracker.interaction({ module: mod, name: "drag-session-to-group" })
        await props.onMoveToGroup?.(source, target.groupId)
      }
    }

    handleSessionDragEnd()
  }

  createEffect(on(sessions, (data) => {
    if (!data) return
    setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  const stable = createMemo(() => fetchedDir() === resolvedDir())

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let pendingScrollId: string | null = null

  type PendingSessionEvent = {
    type: "session.created" | "session.updated" | "session.deleted"
    sessionID: string
    info: Session
  }
  const pendingSessionEvents: PendingSessionEvent[] = []

  function scrollToSession(id: string) {
    setTimeout(() => {
      if (!scrollContainer) return
      const el = scrollContainer.querySelector<HTMLElement>(`[data-session-id="${id}"]`)
      if (!el) return
      const elTop = el.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop
      scrollContainer.scrollTo({ top: Math.max(0, elTop - 46), behavior: "smooth" })
    }, 50)
  }

  function applySessionEvent(ev: PendingSessionEvent) {
    const sessionID = ev.sessionID
    const info = ev.info
    if (info.directory !== resolvedDir()) return
    const idx = sessionList.findIndex(s => s.id === sessionID)
    if (ev.type === "session.created") {
      if (info.agent !== props.agentFilter) return
      if (idx === -1) setSessionList(produce((draft) => { draft.unshift(info) }))
    } else if (ev.type === "session.updated") {
      if (info.time.archived) {
        if (idx >= 0) setSessionList(produce((draft) => { draft.splice(idx, 1) }))
        return
      }
      if (info.agent !== props.agentFilter) {
        if (idx >= 0) setSessionList(produce((draft) => { draft.splice(idx, 1) }))
        return
      }
      if (idx >= 0) {
        setSessionList(produce((draft) => { draft[idx] = info }))
      } else {
        setSessionList(produce((draft) => { draft.unshift(info) }))
      }
    } else if (ev.type === "session.deleted") {
      if (idx >= 0) setSessionList(produce((draft) => { draft.splice(idx, 1) }))
    }
  }

  function flushSessionEvents() {
    if (pendingSessionEvents.length === 0) return
    const events = pendingSessionEvents.splice(0, pendingSessionEvents.length)
    // Merge events for the same session: keep the last state, but preserve
    // created/deleted boundaries so a create followed by an delete is handled.
    // If a created event is updated later, apply as created (then update in place);
    // if a created session is deleted, treat it as a no-op.
    const merged = new Map<string, PendingSessionEvent>()
    for (const ev of events) {
      const existing = merged.get(ev.sessionID)
      if (!existing) {
        merged.set(ev.sessionID, ev)
      } else if (existing.type === "session.created" && ev.type === "session.updated") {
        merged.set(ev.sessionID, { type: "session.created", sessionID: ev.sessionID, info: ev.info })
      } else if (existing.type === "session.created" && ev.type === "session.deleted") {
        merged.delete(ev.sessionID)
      } else if (existing.type === "session.updated" && ev.type === "session.deleted") {
        merged.set(ev.sessionID, ev)
      } else if (existing.type === "session.updated" && ev.type === "session.updated") {
        merged.set(ev.sessionID, ev)
      }
    }
    for (const ev of merged.values()) {
      applySessionEvent(ev)
    }
  }

  function scheduleSidebarAction(delay: number, action: () => void | Promise<void>) {
    if (useServerPagination() && pendingSessionEvents.length > 0) flushSessionEvents()
    clearTimeout(refetchTimer)
    refetchTimer = setTimeout(action, delay)
  }

  async function backfillActiveSession() {
    if (!useServerPagination()) return
    const id = props.activeSessionId()
    if (!id) return
    if (sessionList.some(s => s.id === id)) return
    const d = resolvedDir()
    if (!d) return
    try {
      const session = props.fetchSessionById ? await props.fetchSessionById(d, id) : undefined
      const info = session as Session | undefined
      if (!info) return
      if (resolvedDir() !== d) return
      if (info.directory !== d) return
      if (sessionList.some(s => s.id === id)) return
      if (info.agent !== props.agentFilter || info.time.archived) return
      setSessionList(produce((draft) => { draft.unshift(info) }))
      scrollToSession(id)
    } catch (err) {
      console.error("[agent-sidebar] backfill active session failed", { id, dir: d, error: String(err) })
    }
  }

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      bustSidebarCache()
      if (t === "session.updated") {
        const activeId = props.activeSessionId()
        if (activeId) pendingScrollId = activeId
      }
      clearTimeout(refetchTimer)
      const evtProps = e.details.properties as { sessionID?: string; info?: Session }
      if (evtProps.sessionID && evtProps.info) {
        pendingSessionEvents.push({ type: t, sessionID: evtProps.sessionID, info: evtProps.info })
      }
      refetchTimer = setTimeout(async () => {
        if (useServerPagination()) {
          flushSessionEvents()
          if (pendingScrollId) {
            const id = pendingScrollId
            pendingScrollId = null
            scrollToSession(id)
          }
        } else {
          pendingSessionEvents.length = 0
          await refetch()
          if (pendingScrollId) {
            const id = pendingScrollId
            pendingScrollId = null
            scrollToSession(id)
          }
        }
      }, 1000)
    }
  })
  onCleanup(unsub)

  onMount(() => {
    const el = scrollContainer
    if (!el) return
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100 && hasMoreSessions()) {
        if (useServerPagination()) void loadMoreFromServer(true)
        else {
          setVisibleCount(prev => prev + VISIBLE_BATCH)
          props.onLoadMore?.(Math.min(visibleCount(), recentSessions().length))
        }
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => el.removeEventListener("scroll", onScroll))

    const resizeObserver = new ResizeObserver(() => {
      if (hasMoreSessions() && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight) {
        if (useServerPagination()) void loadMoreFromServer()
        else setVisibleCount(prev => prev + VISIBLE_BATCH)
      }
    })
    resizeObserver.observe(el)
    onCleanup(() => resizeObserver.disconnect())
  })
  onCleanup(() => { clearTimeout(refetchTimer) })

  // Listen for rename events from chat area to scroll to active session
  const handleSessionRenamed = () => {
    const activeId = props.activeSessionId()
    if (!activeId) return
    pendingScrollId = activeId
    scheduleSidebarAction(500, async () => {
      if (useServerPagination()) {
        if (pendingScrollId) {
          const id = pendingScrollId
          pendingScrollId = null
          scrollToSession(id)
        }
      } else {
        await refetch()
        if (pendingScrollId) {
          const id = pendingScrollId
          pendingScrollId = null
          scrollToSession(id)
        }
      }
    })
  }
  window.addEventListener("octo:session-renamed", handleSessionRenamed)
  onCleanup(() => window.removeEventListener("octo:session-renamed", handleSessionRenamed))

  const [collapsed, setCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)
  let createTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(createTimer))

  // Refetch on active session change (safety net for event races)
  createEffect(on(props.activeSessionId, (newId, oldId) => {
    if (newId && newId !== oldId) {
      scheduleSidebarAction(500, () => {
        if (!useServerPagination()) void refetch()
        else void backfillActiveSession()
      })
    }
  }))

  // Scroll to active session once session list data loads after mount (tab switch).
  // Uses a flag so user clicks on sessions don't re-trigger scrolling.
  let didInitialScroll = false
  createEffect(on(
    () => sessionList.length,
    (len) => {
      if (didInitialScroll) return
      if (len > 0) {
        didInitialScroll = true
        const id = props.activeSessionId()
        if (!id) return
        if (sessionList.some(s => s.id === id)) scrollToSession(id)
        else void backfillActiveSession()
      }
    },
  ))

  createEffect(on(sessions, (data) => {
    if (!data) return
    void backfillActiveSession()
  }, { defer: true }))
  // Scroll to active session after rename
  function scrollToActiveSession() {
    const id = props.activeSessionId()
    if (!id) return
    pendingScrollId = id
  }

  // ── Context menu ──
  const [contextMenu, setContextMenu] = createStore<{
    show: boolean
    x: number
    y: number
    session: Session | null
    hasMessages: boolean
  }>({ show: false, x: 0, y: 0, session: null, hasMessages: false })

  function handleMoveToGroup(session: Session, groupId: string) {
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "move-session-to-group" })
    if (session.pinned) void togglePin(session.id)
    props.onMoveToGroup?.(session, groupId)
    closeContextMenu()
  }

  function handleRemoveFromGroup(session: Session) {
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "remove-session-from-group" })
    props.onRemoveFromGroup?.(session)
    closeContextMenu()
  }

  function handleCreateGroupForSession(session: Session) {
    if (session.pinned) void togglePin(session.id)
    props.onCreateGroupForSession?.(session)
    closeContextMenu()
  }

  function closeContextMenu() {
    setContextMenu("show", false)
  }

  // ── Rename ──
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")

  function startRename(session: Session) {
    setRenamingId(session.id)
    setRenameDraft(sessionTitle(session.title) || "无标题")
  }

  async function saveRename(session: Session) {
    const draft = renameDraft().trim()
    if (!draft || !session.id) { setRenamingId(null); return }
    if (draft === (sessionTitle(session.title) || "无标题")) { setRenamingId(null); return }
    const idx = sessionList.findIndex((s) => s.id === session.id)
    if (idx >= 0) setSessionList(idx, "title", draft)
    setRenamingId(null)
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "rename-session" })
    try {
      const client = globalSDK.createClient({ directory: session.directory })
      await client.session.update({ sessionID: session.id, title: draft })
      window.dispatchEvent(new CustomEvent("octo:session-renamed", { detail: { sessionID: session.id, title: draft } }))
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
      if (idx >= 0) setSessionList(idx, "title", session.title)
    }
    // If renamed session is the active one, scroll to it
    if (session.id === props.activeSessionId()) {
      scrollToActiveSession()
    }
  }

  // ── Delete ──
  async function deleteSession(session: Session) {
    tracker.interaction({ module: props.trackerModule ?? "session", name: "delete-session" })
    const nextSession = pickNextSession(sessionList.filter((s) => !s.time?.archived), session.id)

    const ok = await removeSession(globalSDK.createClient({ directory: session.directory }), session.id)
    if (!ok) return
    bustSidebarCache()

    closeContextMenu()
    setSessionList(
      produce((draft) => {
        const i = draft.findIndex((s) => s.id === session.id)
        if (i !== -1) draft.splice(i, 1)
      }),
    )
    if (props.activeSessionId() === session.id) {
      navigate(nextSession ? props.buildSessionRoute(nextSession) : props.buildDeleteFallback(session))
    }
  }

  async function deleteSessions(sessions: Session[]) {
    if (!sessions.length) return
    tracker.interaction({ module: props.trackerModule ?? "session", name: "delete-sessions-in-group" })
    const ids = new Set(sessions.map(s => s.id))
    const deleted = new Set<string>()
    await Promise.all(sessions.map(async (s) => {
      const ok = await removeSession(globalSDK.createClient({ directory: s.directory }), s.id)
      if (ok) deleted.add(s.id)
    }))
    if (deleted.size) {
      bustSidebarCache()
      setSessionList(
        produce((draft) => {
          for (let i = draft.length - 1; i >= 0; i--) {
            if (deleted.has(draft[i].id)) draft.splice(i, 1)
          }
        }),
      )
    }
    const activeId = props.activeSessionId()
    if (activeId && ids.has(activeId)) {
      const remaining = sessionList.filter((s) => !ids.has(s.id) && !s.time?.archived)
      const nextSession = pickNextSession(remaining, activeId)
      navigate(nextSession ? props.buildSessionRoute(nextSession) : props.buildDeleteFallback(sessions[0]))
    }
  }

  function handleContextMenuDelete(session: Session) {
    closeContextMenu()
    dialog.show(() => (
      <DialogDeleteSession
        name={sessionTitle(session.title) ?? language.t("command.session.new")}
        onDelete={() => deleteSession(session)}
      />
    ))
  }

  function handleSessionClick(s: Session) {
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "select-session" })
    props.onSessionClick?.(s)
    navigate(props.buildSessionRoute(s))
  }

  function handleSessionContextMenu(s: Session, e: MouseEvent) {
    if (renamingId()) setRenamingId(null)
    const hasMessages = s.time.updated > s.time.created
    setContextMenu({ show: true, x: e.clientX, y: e.clientY, session: s, hasMessages })
  }

  function handleRenameSave() {
    const session = sessionList.find((s) => s.id === renamingId())
    if (session) void saveRename(session)
  }

  // ── New session ──
  function newSession() {
    if (creating()) return
    setCreating(true)
    clearTimeout(createTimer)
    createTimer = setTimeout(() => setCreating(false), 500)
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "new-session" })
    navigate(props.buildNewRoute())
  }

  return (
    <SidebarShell
      showProjectInfo={props.showProjectInfo}
      showBottomNav={props.showBottomNav}
      newButtonText={props.newButtonText ?? "新建对话"}
      onNewClick={newSession}
      sectionTitle={props.sectionTitle}
      sectionIcon={props.sectionIcon}
      listScrollRef={(el) => { scrollContainer = el }}
      beforeSection={() => (
        <>
          <Show when={pinnedSessions().length > 0}>
            <div
              onDragOver={(e) => { if (draggingSessionId()) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move" } }}
              onDrop={(e) => { e.preventDefault(); performSessionMove({ type: "section", section: "pinned" }) }}
              classList={{ "rounded-[8px] bg-[rgba(10,89,247,0.06)]": !!(draggingSessionId() && pinnedSessions().length === 0) }}
            >
              <SidebarSectionHeader title="置顶" collapsed={pinnedCollapsed()} onToggleCollapse={() => { tracker.interaction({ module: props.trackerModule ?? "session", name: "toggle-pinned-section" }); setPinnedCollapsed(v => !v) }} class="section-header-inline" />
            <Show when={!pinnedCollapsed()}>
              <SessionList
                sessions={pinnedSessions()}
                activeSessionId={props.activeSessionId()}
                stable={stable()}
                hoverOnActive
                useIndex
                onSessionClick={handleSessionClick}
                onSessionContextMenu={handleSessionContextMenu}
                onSessionActionClick={handleSessionContextMenu}
                isContextTarget={(s) => contextMenu.show && contextMenu.session?.id === s.id}
                renamingId={renamingId()}
                renameDraft={renameDraft()}
                onRenameInput={(v) => setRenameDraft(v)}
                onRenameSave={handleRenameSave}
                onRenameCancel={() => setRenamingId(null)}
                itemsDraggable
                draggingSessionId={draggingSessionId()}
                dragOverSessionId={dragOverSessionId()}
                sessionDropPosition={sessionDropPosition()}
                onSessionDragStart={handleSessionDragStart}
                onSessionDragEnd={handleSessionDragEnd}
                onSessionDragOver={handleSessionDragOver}
                onSessionDragLeave={handleSessionDragLeave}
                onSessionDrop={(e, session) => { e.preventDefault(); performSessionMove({ type: "session", sessionId: session.id, position: sessionDropPosition() ?? "before", section: "pinned" }) }}
                onEmptyDrop={() => performSessionMove({ type: "section", section: "pinned" })}
                plainEmptyDropZone
              />
            </Show>
            </div>
          </Show>
          {props.beforeSection?.({
            sessions: sessionList,
            onSessionClick: handleSessionClick,
            onSessionContextMenu: handleSessionContextMenu,
            activeSessionId: props.activeSessionId,
            isContextTarget: (s) => contextMenu.show && contextMenu.session?.id === s.id,
            isPinned: (s) => s.pinned,
            renamingId,
            renameDraft,
            onRenameInput: (v) => setRenameDraft(v),
            onRenameSave: handleRenameSave,
            onRenameCancel: () => setRenamingId(null),
            stable,
            deleteSessions,
            draggingSessionId,
            dragOverSessionId,
            sessionDropPosition,
            onSessionDragStart: handleSessionDragStart,
            onSessionDragEnd: handleSessionDragEnd,
            onSessionDragOver: handleSessionDragOver,
            onSessionDragLeave: handleSessionDragLeave,
            handleSessionDrop: performSessionMove,
          })}
        </>
      )}
      inlineBeforeSection={props.inlineBeforeSection}
      collapsed={collapsed()}
      onToggleCollapse={() => { tracker.interaction({ module: props.trackerModule ?? "session", name: "toggle-recent-section" }); setCollapsed(v => !v) }}
      activeNav={props.skillsActive || location.pathname === "/skills" ? "skill_market" : location.pathname === "/assets" ? "knowledge_base" : activeNav()}
      onNavClick={(key) => {
        if (key === "skill_market" || key === "knowledge_base") {
          if (key === "skill_market" && props.onSkillClick) {
            props.onSkillClick()
          } else {
            if (props.sidebarSourceKey) layout.sidebarSource.set(props.sidebarSourceKey)
            navigate(key === "skill_market" ? "/skills" : "/assets")
          }
          return
        }
        setActiveNav(v => v === key ? null : v)
      }}
      onSettingsClick={props.showSettings ? props.onSettingsClick : undefined}
    >
      <SessionList
        sessions={displayedRecentSessions()}
        activeSessionId={props.activeSessionId()}
        stable={stable()}
        isOnboarding={isOnboarding()}
        hoverOnActive
        onSessionClick={handleSessionClick}
        onSessionContextMenu={handleSessionContextMenu}
        onSessionActionClick={handleSessionContextMenu}
        isContextTarget={(s) => contextMenu.show && contextMenu.session?.id === s.id}
        renamingId={renamingId()}
        renameDraft={renameDraft()}
        onRenameInput={(v) => setRenameDraft(v)}
        onRenameSave={handleRenameSave}
        onRenameCancel={() => setRenamingId(null)}
        itemsDraggable
        draggingSessionId={draggingSessionId()}
        dragOverSessionId={dragOverSessionId()}
        sessionDropPosition={sessionDropPosition()}
        onSessionDragStart={handleSessionDragStart}
        onSessionDragEnd={handleSessionDragEnd}
        onSessionDragOver={handleSessionDragOver}
        onSessionDragLeave={handleSessionDragLeave}
        onSessionDrop={(e, session) => { e.preventDefault(); performSessionMove({ type: "session", sessionId: session.id, position: sessionDropPosition() ?? "before", section: "recent" }) }}
        onEmptyDrop={() => performSessionMove({ type: "section", section: "recent" })}
        plainEmptyDropZone
      />
      <SessionContextMenu
        show={contextMenu.show && !!contextMenu.session}
        x={contextMenu.x}
        y={contextMenu.y}
        session={contextMenu.session}
        hasMessages={contextMenu.hasMessages}
        groups={props.groups}
        sessionGroupMapping={props.sessionGroupMapping}
        onClose={closeContextMenu}
        onRename={(s) => { closeContextMenu(); startRename(s) }}
        onTogglePin={(s) => { closeContextMenu(); togglePin(s.id) }}
        onDelete={handleContextMenuDelete}
        onMoveToGroup={handleMoveToGroup}
        onRemoveFromGroup={handleRemoveFromGroup}
        onCreateGroupForSession={handleCreateGroupForSession}
        onContextMenuBackdrop={(e) => {
          for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
            const sessionEl = el.closest('[data-session-id]')
            if (!sessionEl) continue
            const session = sessionList.find(s => s.id === sessionEl.getAttribute('data-session-id'))
            if (!session) continue
            if (renamingId()) setRenamingId(null)
            setContextMenu({ show: true, x: e.clientX, y: e.clientY, session, hasMessages: session.time.updated > session.time.created })
            return
          }
          closeContextMenu()
        }}
      />
    </SidebarShell>
  )
}
