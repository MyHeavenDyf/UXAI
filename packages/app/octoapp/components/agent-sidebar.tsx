import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { sessionTitle } from "@/utils/session-title"
import { useLayout } from "@/context/layout"
import { tracker } from "@/utils/tracker"
import { SidebarShell } from "@/components/sidebar-shell"
import { SessionList } from "@/components/session-list"

export type AgentSidebarProps = {
  // ── Data ──
  /** Current project directory. Caller is responsible for resolving this. */
  directory: string | null | undefined
  /** Agent string to filter sessions by */
  agentFilter: string
  /** Custom list params passed to client.session.list() */
  listParams?: Record<string, unknown>

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
  sectionIcon: () => JSX.Element
  newButtonText?: string
  trackerModule?: string

  // ── UI toggles ──
  showProjectInfo?: boolean
  showBottomNav?: boolean

  // ── Settings (optional) ──
  showSettings?: boolean
  onSettingsClick?: () => void

  // ── Nav (optional) ──
  sidebarSourceKey?: "cowork" | "make"
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
      const client = globalSDK.createClient({ directory: d })
      const result = await client.session.list(props.listParams as any)
      const data = ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      setFetchedDir(d)
      return data.filter(s => s.agent === props.agentFilter)
    },
  )

  const [sessionList, setSessionList] = createStore<Session[]>([])
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
    const mod = props.trackerModule ?? "session"
    tracker.interaction({ module: mod, name: "delete-session" })
    const idx = sessionList.findIndex((s) => s.id === session.id)
    try {
      const client = globalSDK.createClient({ directory: session.directory })
      await client.session.delete({ sessionID: session.id })
      closeContextMenu()
      if (idx >= 0) {
        setSessionList(sessionList.filter((s) => s.id !== session.id))
      }
      if (props.activeSessionId() === session.id) {
        navigate(props.buildDeleteFallback(session))
        void refetch()
      }
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  function handleContextMenuDelete() {
    const session = contextMenu.session
    if (!session) return
    closeContextMenu()
    dialog.show(() => (
      <Dialog title="删除会话" fit class="delete-dialog">
        <span class="text-[14px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
          确定删除"{sessionTitle(session.title) || "无标题"}"？
        </span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button variant="primary" size="large" class="delete-dialog-btn delete-dialog-btn-primary" onClick={() => { void deleteSession(session).then(() => dialog.close()) }}>
            删除
          </Button>
        </div>
      </Dialog>
    ))
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
      collapsed={collapsed()}
      onToggleCollapse={() => setCollapsed(v => !v)}
      activeNav={props.skillsActive || location.pathname === "/skills" ? "skill_market" : activeNav()}
      onNavClick={(key) => {
        if (key === "skill_market") {
          if (props.onSkillClick) {
            props.onSkillClick()
          } else {
            if (props.sidebarSourceKey) layout.sidebarSource.set(props.sidebarSourceKey)
            navigate("/skills")
          }
        } else {
          setActiveNav(v => v === key ? null : v)
        }
      }}
      onSettingsClick={props.showSettings ? props.onSettingsClick : undefined}
    >
      <SessionList
        sessions={sessionList}
        activeSessionId={props.activeSessionId()}
        stable={stable()}
        isOnboarding={isOnboarding()}
        onSessionClick={(s) => {
          const mod = props.trackerModule ?? "session"
          tracker.interaction({ module: mod, name: "select-session" })
          navigate(props.buildSessionRoute(s))
        }}
        onSessionContextMenu={(s, e) => {
          if (renamingId()) setRenamingId(null)
          const hasMessages = s.time.updated > s.time.created
          setContextMenu({ show: true, x: e.clientX, y: e.clientY, session: s, hasMessages })
        }}
        isContextTarget={(s) => contextMenu.show && contextMenu.session?.id === s.id}
        renamingId={renamingId()}
        renameDraft={renameDraft()}
        onRenameInput={(v) => setRenameDraft(v)}
        onRenameSave={() => {
          const session = sessionList.find((s) => s.id === renamingId())
          if (session) void saveRename(session)
        }}
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
                transform: "translateX(12px)",
                "min-width": "132px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Show when={contextMenu.hasMessages}>
                <button
                  data-slot="dropdown-menu-item"
                  onClick={() => {
                    const s = contextMenu.session
                    if (!s) return
                    closeContextMenu()
                    startRename(s)
                  }}
                >
                  <span data-slot="dropdown-menu-item-label">重命名</span>
                </button>
                <div data-slot="dropdown-menu-separator" />
              </Show>
              <button
                data-slot="dropdown-menu-item"
                onClick={handleContextMenuDelete}
              >
                <span data-slot="dropdown-menu-item-label">删除</span>
              </button>
            </div>
          </div>
        </Portal>
      </Show>
    </SidebarShell>
  )
}
