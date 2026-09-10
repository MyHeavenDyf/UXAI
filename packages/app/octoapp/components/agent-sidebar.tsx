import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogDeleteSession } from "@/components/dialog-delete-session"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, Show, For, type JSX } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { sessionTitle } from "@/utils/session-title"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { tracker } from "@/utils/tracker"
import { pickNextSession } from "@/utils/session-delete"
import { useSessionDelete } from "@/hooks/use-session-delete"
import { SidebarShell, SidebarSectionHeader } from "@/components/sidebar-shell"
import { SessionList } from "@/components/session-list"
import { Icon } from "@opencode-ai/ui/icon"
import trashPng from "@/pages/_shell/icons/trash.png"
import pinPng from "@/pages/_shell/icons/pin.png"
import folderBadgePlusPng from "@/pages/_shell/icons/folder_badge_plus.png"
import arrowRightFolderCirclePng from "@/pages/_shell/icons/arrow_right_folder_circle.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"
import folderLineClosePng from "@/pages/_shell/icons/Folder_line_close.png"

export type SidebarGroup = { id: string; name: string }

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

  // ── Groups (optional, for make/design) ──
  /** Available groups. When provided, the context menu shows a "移动到分组" submenu. */
  groups?: SidebarGroup[]
  /** Session-to-group mapping (sessionId -> groupId). Sessions with a mapping are excluded from "最近". */
  sessionGroupMapping?: Record<string, string>
  /** Called when the user selects a group in the "移动到分组" submenu. */
  onMoveToGroup?: (session: Session, groupId: string) => void
  /** Called when the user clicks "移出此分组" in the context menu. */
  onRemoveFromGroup?: (session: Session) => void
  /** Called when the user clicks "新建分组" in the "移动到分组" submenu. Implementations should open the create-group dialog, then move the current session into the newly created group. */
  onCreateGroupForSession?: (session: Session) => void

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

export function AgentSidebar(props: AgentSidebarProps) {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const layout = useLayout()
  const language = useLanguage()
  const removeSession = useSessionDelete()

  const resolvedDir = () => props.directory ?? undefined
  const [fetchedDir, setFetchedDir] = createSignal<string>()

  const isOnboarding = createMemo(() => !resolvedDir())

  const [sessions, { refetch }] = createResource(
    () => isOnboarding() ? "" : (resolvedDir() ?? ""),
    async (d) => {
      if (!d) {
        setFetchedDir(d)
        return [] as Session[]
      }
      const data = props.fetchSessions
        ? await props.fetchSessions(d)
        : ((await globalSDK.createClient({ directory: d }).session.list(props.listParams as any)).data ?? []) as Session[]
      const sorted = data.sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      setFetchedDir(d)
      return sorted.filter(s => s.agent === props.agentFilter)
    },
  )

  const pinStorageKey = `octo:pinned-sessions:${props.sidebarSourceKey ?? "default"}`
  const [sessionList, setSessionList] = createStore<Session[]>([])
  const [pinnedIds, setPinnedIds] = createSignal<Set<string>>((() => { try { return new Set<string>(JSON.parse(localStorage.getItem(pinStorageKey) ?? "[]")) } catch { return new Set<string>() } })())
  const [pinnedCollapsed, setPinnedCollapsed] = createSignal(false)

  const pinnedSessions = createMemo(() => sessionList.filter(s => pinnedIds().has(s.id)))
  const recentSessions = createMemo(() => sessionList.filter(s => !pinnedIds().has(s.id) && !props.sessionGroupMapping?.[s.id]))

  const VISIBLE_BATCH = 30
  const [visibleCount, setVisibleCount] = createSignal(VISIBLE_BATCH)
  const displayedRecentSessions = createMemo(() => recentSessions().slice(0, visibleCount()))
  const hasMoreSessions = createMemo(() => visibleCount() < recentSessions().length)

  createEffect(on(resolvedDir, () => setVisibleCount(VISIBLE_BATCH), { defer: true }))

  function togglePin(id: string) {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    try { localStorage.setItem(pinStorageKey, JSON.stringify([...pinnedIds()])) } catch {}
  }

  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  const stable = createMemo(() => fetchedDir() === resolvedDir())

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let pendingScrollId: string | null = null

  function scrollToSession(id: string) {
    setTimeout(() => {
      const scrollContainer = document.querySelector<HTMLElement>('[data-slot="list-scroll"]')
      if (!scrollContainer) return
      const el = scrollContainer.querySelector<HTMLElement>(`[data-session-id="${id}"]`)
      if (el) {
        const elTop = el.offsetTop
        scrollContainer.scrollTop = Math.max(0, elTop - 10)
      }
    }, 50)
  }

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      if (t === "session.updated") {
        const activeId = props.activeSessionId()
        if (activeId) pendingScrollId = activeId
      }
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(async () => {
        await refetch()
        if (pendingScrollId) {
          const id = pendingScrollId
          pendingScrollId = null
          scrollToSession(id)
        }
      }, 1000)
    }
  })
  onCleanup(unsub)

  onMount(() => {
    const scrollContainer = document.querySelector<HTMLElement>('[data-slot="list-scroll"]')
    if (!scrollContainer) return
    const onScroll = () => {
      if (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 100 && hasMoreSessions()) {
        setVisibleCount(prev => prev + VISIBLE_BATCH)
      }
    }
    scrollContainer.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => scrollContainer.removeEventListener("scroll", onScroll))
  })
  onCleanup(() => { clearTimeout(refetchTimer) })

  // Listen for rename events from chat area to scroll to active session
  const handleSessionRenamed = () => {
    const activeId = props.activeSessionId()
    if (!activeId) return
    pendingScrollId = activeId
    clearTimeout(refetchTimer)
    refetchTimer = setTimeout(async () => {
      await refetch()
      if (pendingScrollId) {
        const id = pendingScrollId
        pendingScrollId = null
        scrollToSession(id)
      }
    }, 500)
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
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 500)
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
        if (id) scrollToSession(id)
      }
    },
  ))
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

  const [menuStyle, setMenuStyle] = createSignal<{ left: string; top: string; visibility: "visible" | "hidden" }>({
    left: "0px",
    top: "0px",
    visibility: "hidden",
  })

  const [contextMenuRef, setContextMenuRef] = createSignal<HTMLDivElement | undefined>(undefined)

  // ── Context menu submenu ("移动到分组") ──
  const [showGroupSubmenu, setShowGroupSubmenu] = createSignal(false)
  let submenuHideTimer: ReturnType<typeof setTimeout> | undefined
  const showSubmenuNow = () => { clearTimeout(submenuHideTimer); setShowGroupSubmenu(true) }
  const scheduleHideSubmenu = () => { clearTimeout(submenuHideTimer); submenuHideTimer = setTimeout(() => setShowGroupSubmenu(false), 200) }

  const submenuSide = createMemo<"right" | "left">(() => {
    if (!showGroupSubmenu()) return "right"
    const menuLeft = parseFloat(menuStyle().left) || 0
    return menuLeft + 175 * 2 + 24 > window.innerWidth ? "left" : "right"
  })

  function handleMoveToGroup(groupId: string) {
    const session = contextMenu.session
    if (!session) return
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "move-session-to-group" })
    if (pinnedIds().has(session.id)) togglePin(session.id)
    props.onMoveToGroup?.(session, groupId)
    closeContextMenu()
  }

  function handleRemoveFromGroup() {
    const session = contextMenu.session
    if (!session) return
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "remove-session-from-group" })
    props.onRemoveFromGroup?.(session)
    closeContextMenu()
  }

  function handleCreateGroupForSession() {
    const session = contextMenu.session
    if (!session) return
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "create-group-for-session" })
    if (pinnedIds().has(session.id)) togglePin(session.id)
    props.onCreateGroupForSession?.(session)
    closeContextMenu()
  }

  createEffect(() => {
    if (contextMenu.show && contextMenu.session) {
      requestAnimationFrame(() => {
        const menu = contextMenuRef()
        if (!menu) return
        const menuHeight = menu.offsetHeight
        const menuWidth = menu.offsetWidth
        const viewportHeight = window.innerHeight
        const viewportWidth = window.innerWidth
        const minMargin = 24
        let top = contextMenu.y
        if (top + menuHeight > viewportHeight - minMargin) {
          top = Math.max(0, viewportHeight - menuHeight - minMargin)
        }
        let left = contextMenu.x
        if (left + menuWidth > viewportWidth - minMargin) {
          left = Math.max(0, viewportWidth - menuWidth - minMargin)
        }
        setMenuStyle({
          left: `${left}px`,
          top: `${top}px`,
          visibility: "visible",
        })
      })
    }
  })

  function closeContextMenu() {
    clearTimeout(submenuHideTimer)
    setShowGroupSubmenu(false)
    setContextMenu("show", false)
    setMenuStyle({ left: "0px", top: "0px", visibility: "hidden" })
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

    closeContextMenu()
    setSessionList(
      produce((draft) => {
        const i = draft.findIndex((s) => s.id === session.id)
        if (i !== -1) draft.splice(i, 1)
      }),
    )
    if (props.activeSessionId() === session.id) {
      navigate(nextSession ? props.buildSessionRoute(nextSession) : props.buildDeleteFallback(session))
      void refetch()
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
      void refetch()
    }
  }

  function handleContextMenuDelete() {
    const session = contextMenu.session
    if (!session) return
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
      beforeSection={() => (
        <>
          <Show when={pinnedSessions().length}>
            <SidebarSectionHeader title="置顶" collapsed={pinnedCollapsed()} onToggleCollapse={() => setPinnedCollapsed(v => !v)} class="section-header-inline" />
            <Show when={!pinnedCollapsed()}>
              <SessionList
                sessions={pinnedSessions()}
                activeSessionId={props.activeSessionId()}
                stable={stable()}
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
              />
            </Show>
          </Show>
          {props.beforeSection?.({
            sessions: sessionList,
            onSessionClick: handleSessionClick,
            onSessionContextMenu: handleSessionContextMenu,
            activeSessionId: props.activeSessionId,
            isContextTarget: (s) => contextMenu.show && contextMenu.session?.id === s.id,
            isPinned: (s) => pinnedIds().has(s.id),
            renamingId,
            renameDraft,
            onRenameInput: (v) => setRenameDraft(v),
            onRenameSave: handleRenameSave,
            onRenameCancel: () => setRenamingId(null),
            stable,
            deleteSessions,
          })}
        </>
      )}
      inlineBeforeSection={props.inlineBeforeSection}
      collapsed={collapsed()}
      onToggleCollapse={() => setCollapsed(v => !v)}
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
      />
      <Show when={contextMenu.show && contextMenu.session}>
        <Portal>
          <div
            class="fixed inset-0 z-50"
            onContextMenu={(e) => {
              e.preventDefault()
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
            onClick={closeContextMenu}
            onKeyDown={(e) => { if (e.key === "Escape") closeContextMenu() }}
            tabIndex={-1}
            ref={(el) => { requestAnimationFrame(() => el?.focus()) }}
          >
            <div
              ref={setContextMenuRef}
              data-component="dropdown-menu-content"
              style={{
                position: "absolute",
                left: menuStyle().left,
                top: menuStyle().top,
                visibility: menuStyle().visibility,
                width: "175px",
                padding: "4px",
                display: "flex",
                "flex-direction": "column",
                gap: "4px",
                overflow: "visible",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Show when={contextMenu.hasMessages}>
                <button
                  data-slot="dropdown-menu-item"
                  class="flex items-center gap-2"
                  onClick={() => {
                    const s = contextMenu.session
                    if (!s) return
                    closeContextMenu()
                    startRename(s)
                  }}
                >
                  <img src={squareAndPencilPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                  <span data-slot="dropdown-menu-item-label">重命名</span>
                </button>
              </Show>
              <button
                data-slot="dropdown-menu-item"
                class="flex items-center gap-2"
                onClick={() => {
                  const s = contextMenu.session
                  if (!s) return
                  closeContextMenu()
                  togglePin(s.id)
                }}
              >
                <img src={pinPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                <span data-slot="dropdown-menu-item-label">{contextMenu.session && pinnedIds().has(contextMenu.session.id) ? "取消置顶聊天" : "置顶"}</span>
              </button>
              <button
                data-slot="dropdown-menu-item"
                class="flex items-center gap-2"
                onClick={handleContextMenuDelete}
              >
                <img src={trashPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                <span data-slot="dropdown-menu-item-label">删除</span>
              </button>
              <Show when={props.groups}>
                <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "2px 0" }} />
                <div
                  class="relative"
                  onMouseEnter={showSubmenuNow}
                  onMouseLeave={scheduleHideSubmenu}
                >
                  <button
                    data-slot="dropdown-menu-item"
                    class="flex items-center gap-2 w-full"
                    style={{ "justify-content": "space-between" }}
                    onMouseEnter={showSubmenuNow}
                  >
                    <span class="flex items-center gap-2">
                      <img src={arrowRightFolderCirclePng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                      <span data-slot="dropdown-menu-item-label">移动到分组</span>
                    </span>
                    <Icon name="chevron-right" size="small" style={{ width: "14px", height: "14px", color: "rgba(0,0,0,0.4)" }} />
                  </button>
                  <Show when={showGroupSubmenu()}>
                    <div
                      data-component="dropdown-menu-content"
                      class="absolute"
                      style={{
                        position: "absolute",
                        ...(submenuSide() === "right"
                          ? { left: "calc(100% + 4px)" }
                          : { right: "calc(100% + 4px)" }),
                        top: "-4px",
                        width: "175px",
                        "max-height": "200px",
                        "min-height": "40px",
                        padding: "4px 2px 4px 4px",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "4px",
                        overflow: "auto",
                      }}
                      onMouseEnter={showSubmenuNow}
                      onMouseLeave={scheduleHideSubmenu}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div class="submenu-scroll" style={{ "overflow-y": "auto", "min-height": "0" }}>
                        <Show
                          when={props.groups!.length}
                          fallback={
                            <div class="flex items-center text-[12px] leading-[20px]" style={{ height: "36px", "padding-left": "8px", color: "rgba(0,0,0,0.4)", "flex-shrink": "0" }}>
                              暂无可移动的数据
                            </div>
                          }
                        >
                          <For each={props.groups}>
                            {(group) => (
                              <button
                                data-slot="dropdown-menu-item"
                                class="flex items-center gap-2"
                                style={{ height: "36px", "flex-shrink": "0" }}
                                onClick={() => handleMoveToGroup(group.id)}
                              >
                      <img src={folderLineClosePng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                                <span data-slot="dropdown-menu-item-label" class="flex-1" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{group.name}</span>
                                <Show when={contextMenu.session && props.sessionGroupMapping?.[contextMenu.session.id] === group.id}>
                                  <Icon name="check-small" size="small" style={{ color: "#0A59F7" }} />
                                </Show>
                              </button>
                            )}
                          </For>
                        </Show>
                      </div>
                      <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "2px 0", "flex-shrink": "0" }} />
                      <button
                        data-slot="dropdown-menu-item"
                        class="flex items-center gap-2"
                        style={{ height: "36px", "flex-shrink": "0" }}
                        onClick={handleCreateGroupForSession}
                      >
                        <img src={folderLineClosePng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                        <span data-slot="dropdown-menu-item-label">新建分组</span>
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
              <Show when={contextMenu.session && props.sessionGroupMapping?.[contextMenu.session.id] && !pinnedIds().has(contextMenu.session.id)}>
                <button
                  data-slot="dropdown-menu-item"
                  class="flex items-center gap-2"
                  onClick={handleRemoveFromGroup}
                >
                  <img src={folderBadgePlusPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                  <span data-slot="dropdown-menu-item-label">移出此分组</span>
                </button>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </SidebarShell>
  )
}
