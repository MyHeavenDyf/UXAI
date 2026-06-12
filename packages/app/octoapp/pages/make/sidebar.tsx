import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings, IconSettings1,
} from "@/pages/_shell/icons"
import { ProjectInfo } from "@/components/project-info"

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none"
      style={{
        transform: props.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgba(0,0,0,0.6)"/>
    </svg>
  )
}

const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1 },
] as const

export function MakeSidebar(props: { width: number }): JSX.Element {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const notification = useNotification()
  const permission = usePermission()
  const language = useLanguage()
  const layout = useLayout()

  const projectDir = useProjectDir()

  const [resolvedDir, setResolvedDir] = createSignal<string>()
  const [makeFetchedDir, setMakeFetchedDir] = createSignal<string>()

  const isOnboarding = createMemo(() => !resolvedDir())

  createEffect(() => {
    const d = projectDir()
    if (d) setResolvedDir(d)
  })

  createEffect(() => {
    if (!globalSync.data.ready) {
      const d = projectDir()
      if (d) setResolvedDir(d)
    }
  })

  const [sessions, { refetch }] = createResource(
    () => isOnboarding() ? "" : (resolvedDir() ?? ""),
    async (d) => {
      if (!d) {
        setMakeFetchedDir(d)
        return [] as Session[]
      }
      const client = globalSDK.createClient({ directory: d })
      const result = await client.session.list()
      const data = ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      setMakeFetchedDir(d)
      return data.filter(s => s.agent === "octo_make")
    },
  )

  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  const makeStable = createMemo(() => makeFetchedDir() === resolvedDir())

  let refetchTimer: ReturnType<typeof setTimeout> | undefined

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 1000)
    }
  })
  onCleanup(unsub)
  onCleanup(() => { clearTimeout(refetchTimer) })

  const activeSessionId = () => {
    const m = location.pathname.match(/^\/make\/(.+)$/)
    return m?.[1]
  }

  const [makeCollapsed, setMakeCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)
  let createTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(createTimer))

  // 在导航到新对话时兜底刷新列表，防止事件竞争导致列表遗漏
  createEffect(on(activeSessionId, (newId, oldId) => {
    if (newId && newId !== oldId) {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 500)
    }
  }))

  const [contextMenu, setContextMenu] = createStore<{
    show: boolean
    x: number
    y: number
    session: Session | null
    hasMessages: boolean
  }>({ show: false, x: 0, y: 0, session: null, hasMessages: false })

  function closeContextMenu() {
    setContextMenu("show", false)
  }

  async function deleteSession(sessionID: string, directory: string) {
    const idx = sessionList.findIndex((s) => s.id === sessionID)
    try {
      const client = globalSDK.createClient({ directory })
      await client.session.delete({ sessionID })
      closeContextMenu()
      if (idx >= 0) {
        setSessionList(sessionList.filter((s) => s.id !== sessionID))
      }
      if (activeSessionId() === sessionID) {
        navigate("/make")
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
          确定删除「{sessionTitle(session.title) || "无标题"}」？
        </span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button
            variant="ghost"
            size="large"
            class="delete-dialog-btn"
            onClick={() => dialog.close()}
          >
            取消
          </Button>
          <Button
            variant="primary"
            size="large"
            class="delete-dialog-btn delete-dialog-btn-primary"
            onClick={() => { void deleteSession(session.id, session.directory).then(() => dialog.close()) }}
          >
            删除
          </Button>
        </div>
      </Dialog>
    ))
  }

  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  let renameInputRef: HTMLInputElement | undefined

  function startRename(session: Session) {
    setRenamingId(session.id)
    setRenameDraft(sessionTitle(session.title) || "无标题")
    requestAnimationFrame(() => renameInputRef?.focus())
  }

  async function saveRename(session: Session) {
    const draft = renameDraft().trim()
    if (!draft || !session.id) { setRenamingId(null); return }
    const idx = sessionList.findIndex((s) => s.id === session.id)
    if (idx >= 0) setSessionList(idx, "title", draft)
    setRenamingId(null)
    try {
      const client = globalSDK.createClient({ directory: session.directory })
      await client.session.update({ sessionID: session.id, title: draft })
      window.dispatchEvent(new CustomEvent("octo:make:session-renamed", { detail: { sessionID: session.id, title: draft } }))
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
      if (idx >= 0) setSessionList(idx, "title", session.title)
    }
  }

  function newSession() {
    if (creating()) return
    setCreating(true)
    clearTimeout(createTimer)
    createTimer = setTimeout(() => setCreating(false), 500)
    const dir = resolvedDir()
    if (!dir) return
    const client = globalSDK.createClient({ directory: dir })
    void client.session.create({ directory: dir, agent: "octo_make" }).then((result) => {
      const session = result.data as Session | undefined
      if (session) navigate(`/make/${session.id}`)
    })
  }

  return (
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: `${props.width}px`,
        "padding-top": "12px",
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        "border-right": "1px solid var(--border-weak-base)",
      }}
    >
      <div class="shrink-0 flex flex-col px-[12px]">
        <ProjectInfo />
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-3 w-full mb-[8px] rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
            style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
            onClick={newSession}
          >
            <Icon name="plus" size="normal" class="shrink-0" />
            <span>新建</span>
          </button>
        </div>
        <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", "margin-bottom": "8px" }} />
      </div>

      <div
        data-slot="list-scroll"
        class="flex-1 min-h-0 overflow-y-auto px-[12px]"
      >
        <div class="mb-[2px]">
          <div class="flex items-center h-[36px] px-[12px]">
            <button
              type="button"
              onClick={() => setMakeCollapsed((v) => !v)}
              class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
            >
              <span class="flex items-center gap-[12px] min-w-0">
                <img src="/makeIcon.svg" alt="" style={{ width: "20px", height: "20px" }} />
                <span class="text-[12px] leading-[20px] select-none truncate" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                  Octo Design
                </span>
              </span>
              <ChevronRightIcon collapsed={makeCollapsed()} />
            </button>
          </div>

          <Show when={!makeCollapsed()}>
            <div class="flex flex-col">
              <Show
                when={makeStable()}
                fallback={
                  <div class="px-[8px] py-[6px]">
                    <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                  </div>
                }
              >
                <Show
                  when={sessionList.length > 0}
                  fallback={
                    <div class="px-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                      {isOnboarding() ? "请先选择项目目录" : "暂无对话"}
                    </div>
                  }
                >
                  <For each={sessionList}>
                    {(session) => {
                      const isActive = () => activeSessionId() === session.id
                      const [sessionStore] = globalSync.child(session.directory)
                      const isWorking = createMemo(() => {
                        const status = sessionStore.session_status[session.id]
                        return status !== undefined && status.type !== "idle"
                      })
                      const unseenCount = createMemo(() => notification.session.unseenCount(session.id))
                      const hasError = createMemo(() => notification.session.unseenHasError(session.id))
                      const hasPermissions = createMemo(() =>
                        !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, session.id, (item) =>
                          !permission.autoResponds(item, session.directory),
                        ),
                      )
                      const hasMessages = createMemo(() => {
                        return session.time.updated > session.time.created
                      })
                      const isRenaming = () => renamingId() === session.id
                      const isContextTarget = () => contextMenu.show && contextMenu.session?.id === session.id
                      return (
                        <Show when={!isRenaming()} fallback={
                          <div
                            class="w-full rounded-[8px] flex items-center"
                            style={{ height: "36px", padding: "0 24px 0 44px" }}
                          >
                            <input
                              ref={renameInputRef}
                              value={renameDraft()}
                              onInput={(e) => setRenameDraft(e.currentTarget.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === "Enter") { e.preventDefault(); void saveRename(session) }
                                if (e.key === "Escape") { e.preventDefault(); setRenamingId(null) }
                              }}
                              onBlur={() => void saveRename(session)}
                              class="w-full text-[12px] leading-[20px]"
                              style={{
                                color: isActive() ? "#0A59F7" : "rgba(0,0,0,0.9)",
                                border: "1px solid #0a59f7",
                                "border-radius": "6px",
                                padding: "4px",
                                background: "transparent",
                                outline: "none",
                              }}
                            />
                          </div>
                        }>
                          <button
                            type="button"
                            onClick={() => {
                              notification.session.markViewed(session.id)
                              // 确保session属于当前项目目录，否则刷新列表
                              if (session.directory !== resolvedDir()) {
                                void refetch()
                                return
                              }
                              navigate(`/make/${session.id}`)
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setContextMenu({ show: true, x: e.clientX, y: e.clientY, session, hasMessages: hasMessages() })
                            }}
                            class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center relative"
                            style={{
                              height: "36px",
                              padding: "0 24px 0 44px",
                              color: isActive() ? "#0A59F7" : undefined,
                            }}
                            classList={{
                              "bg-[rgba(10,89,247,0.08)]": isActive(),
                              "hover:bg-surface-base-hover": !isActive() && !isContextTarget(),
                              "bg-[rgba(0,0,0,0.06)]": isContextTarget(),
                            }}
                          >
                            <Show when={isActive()}>
                              <span
                                class="absolute right-[12px] top-1/2 rounded-full pointer-events-none"
                                style={{
                                  height: "28px",
                                  width: "4px",
                                  background: "#0A59F7",
                                  transform: "translateY(-50%)",
                                }}
                              />
                            </Show>
                            <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
                              <div class="shrink-0 size-6 flex items-center justify-center">
                                <Switch>
                                  <Match when={isWorking()}>
                                    <Spinner class="size-[15px]" />
                                  </Match>
                                  <Match when={hasPermissions()}>
                                    <div class="size-1.5 rounded-full bg-surface-warning-strong" />
                                  </Match>
                                  <Match when={hasError()}>
                                    <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
                                  </Match>
                                  <Match when={unseenCount() > 0}>
                                    <div class="size-1.5 rounded-full bg-text-interactive-base" />
                                  </Match>
                                </Switch>
                              </div>
                            </Show>
                            <span class="flex-1 min-w-0 truncate">{sessionTitle(session.title) || "无标题"}</span>
                          </button>
                        </Show>
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div
        class="shrink-0 flex flex-col gap-[2px] px-[12px] pt-[12px]"
      >
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () =>
              item.key === "skill_market"
                ? location.pathname === "/skills"
                : activeNav() === item.key
            return (
              <button
                type="button"
                onClick={() => {
                  if (item.key === "skill_market") {
                    layout.sidebarSource.set("make")
                    navigate("/skills")
                  } else {
                    setActiveNav((v) => (v === item.key ? null : item.key))
                  }
                }}
                title={item.label}
                classList={{
                  "w-full relative flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors text-[14px] leading-[22px]": true,
                }}
                style={{
                  height: "36px",
                  background: isActive() ? "var(--surface-base-interactive-active)" : "transparent",
                  color: isActive() ? "var(--text-interactive-base)" : "var(--text-strong)",
                  "font-weight": isActive() ? "500" : "400",
                }}
                onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--surface-base-hover)" }}
                onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
              >
                <span class="flex items-center justify-center shrink-0">
                  <Show when={isActive()} fallback={<item.Icon size={16} />}>
                    <item.IconActive size={16} />
                  </Show>
                </span>
                <span class="truncate">{item.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute right-0 top-1/2 rounded-l-[3px]"
                    style={{
                      height: "20px",
                      width: "3px",
                      background: "var(--text-interactive-base)",
                      transform: "translateY(-50%)",
                    }}
                  />
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      <div class="shrink-0 px-[12px] pb-[24px]">
        <button
          type="button"
          title="设置"
          class="w-full flex items-center gap-[12px] px-[12px] rounded-[4px] transition-colors"
          style={{ height: "36px", color: "var(--text-strong)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-base-hover)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          onClick={() => dialog.show(() => <DialogSettings />)}
        >
          <IconSettings size={16} />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>
      <Show when={contextMenu.show && contextMenu.session}>
        <Portal>
          <div
            class="fixed inset-0 z-50"
            onContextMenu={(e) => e.preventDefault()}
            onClick={closeContextMenu}
            onKeyDown={(e) => { if (e.key === "Escape") closeContextMenu() }}
            tabIndex={-1}
            ref={(el) => { requestAnimationFrame(() => el?.focus()) }}
          >
            <div
              data-component="dropdown-menu-content"
              style={{
                position: "absolute",
                left: `${contextMenu.x}px`,
                top: `${contextMenu.y}px`,
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
    </div>
  )
}