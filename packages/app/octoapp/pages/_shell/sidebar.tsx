import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings, IconSettings1,
} from "./icons"
import { ProjectInfo } from "@/pages/cowork/components/project-info"

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{
        transform: props.collapsed ? "rotate(0deg)" : "rotate(90deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function InsightIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" />
      <path d="M10 5v5l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
    </svg>
  )
}

function MakeIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M6.5 17.5L3.5 14.5L13.5 4.5L16.5 7.5L6.5 17.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <circle cx="14" cy="6" r="2" stroke="currentColor" stroke-width="1.5" />
      <circle cx="6" cy="14" r="2" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

function SkillIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2L12.09 6.64L17 6.64L13.35 9.82L14.63 14.47L10 11.6L5.37 14.47L6.65 9.82L3 6.64L7.91 6.64L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
    </svg>
  )
}

function AssetIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M2 6.5L10 2L18 6.5V13.5L10 18L2 13.5V6.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M2 6.5L10 10.5L18 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path d="M10 10.5V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <img src="/IconSettings.svg" alt="" style={{ width: "16px", height: "16px" }} />
  )
}

const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1 },
] as const

export function OctoSidebar(props: { width: number }): JSX.Element {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const notification = useNotification()
  const permission = usePermission()
  const language = useLanguage()

  const projectDir = useProjectDir()
  const isOnboarding = createMemo(() => location.pathname === "/")

  // Resolved directory signal — the single source of truth for session loading.
  // Populated by two effects from different reliable reactive sources.
  const [resolvedDir, setResolvedDir] = createSignal<string>()

  // Track which directory the fetched data came from, so we only show content
  // when the data matches the current directory (prevents flicker when dir changes from home → project)
  const [insightFetchedDir, setInsightFetchedDir] = createSignal<string>()
  const [makeFetchedDir, setMakeFetchedDir] = createSignal<string>()

  // Effect 1: read projectDir() which tracks server.projects.last (memo, reactive).
  // For returning users this fires immediately on mount with the persisted directory.
  createEffect(() => {
    const d = projectDir()
    if (d) setResolvedDir(d)
  })

  // Effect 2: track globalSync.data.ready (= bootstrap.isPending from useQuery, reliable).
  // When bootstrap completes, explicitly read projectDir() — by then pathQuery.data is cached
  // and the getter returns the real path even though the reactivity chain is broken.
  createEffect(() => {
    if (!globalSync.data.ready) {
      const d = projectDir()
      if (d) setResolvedDir(d)
    }
  })

  // Insight sessions
  const [sessions, { refetch }] = createResource(
    () => isOnboarding() ? "" : (resolvedDir() ?? ""),
    async (d) => {
      if (!d) {
        setInsightFetchedDir(d)
        return [] as Session[]
      }
      const client = globalSDK.createClient({ directory: d })
      const result = await client.session.list()
      const data = ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      setInsightFetchedDir(d)
      return data.filter(s => s.agent === "octo_insight")
    },
  )

  // Reconciled store with key="id" so <For> items keep stable references
  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  // Insight data is "stable" when fetched dir matches current dir
  const insightStable = createMemo(() => insightFetchedDir() === resolvedDir())

  // Make sessions
  const [makeSessions, { refetch: refetchMake }] = createResource(
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

  const [makeSessionList, setMakeSessionList] = createStore<Session[]>([])
  createEffect(on(makeSessions, (data) => {
    if (data) setMakeSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

  const makeStable = createMemo(() => makeFetchedDir() === resolvedDir())

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let refetchMakeTimer: ReturnType<typeof setTimeout> | undefined

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 1000)
      clearTimeout(refetchMakeTimer)
      refetchMakeTimer = setTimeout(() => void refetchMake(), 1000)
    }
  })
  onCleanup(unsub)
  onCleanup(() => { clearTimeout(refetchTimer); clearTimeout(refetchMakeTimer) })

  const activeSessionId = () => {
    const m = location.pathname.match(/^\/(?:insight|make)\/(.+)$/)
    return m?.[1]
  }

  const [insightCollapsed, setInsightCollapsed] = createSignal(false)
  const [makeCollapsed, setMakeCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)
  const [showDropdown, setShowDropdown] = createSignal(false)
  const [dropdownPos, setDropdownPos] = createSignal({ top: 0, left: 0 })

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation()
    const btn = e.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom, left: rect.left + 87 })
    setShowDropdown((v) => !v)
  }

  function closeDropdown() {
    setShowDropdown(false)
  }

  createEffect(() => {
    if (showDropdown()) {
      document.addEventListener("click", closeDropdown)
      onCleanup(() => document.removeEventListener("click", closeDropdown))
    }
  })

  function newSession() {
    const dir = resolvedDir()
    if (!dir) return
    const client = globalSDK.createClient({ directory: dir })
    void client.session.create({ directory: dir, agent: "octo_insight" }).then((result) => {
      const session = result.data as Session | undefined
      if (session) navigate(`/insight/${session.id}`)
    })
  }

  function newMakeSession() {
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
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        padding: "8px",
        "border-right": "1px solid var(--border-weak-base)",
      }}
    >
      {/* 顶部：ProjectInfo + 新建交付件 */}
      <div class="flex flex-col gap-2 shrink-0">
        <ProjectInfo />
        <button
          type="button"
          class="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
          style={{ height: "44px", color: "#191919", "font-size": "12px", "line-height": "20px", "font-weight": "500" }}
          onClick={toggleDropdown}
        >
          <Icon name="plus" size="normal" class="shrink-0" />
          <span>新建交付件</span>
        </button>
        <Show when={showDropdown()}>
          <div
            class="z-50 flex flex-col"
            style={`position:fixed; top:${dropdownPos().top}px; left:${dropdownPos().left}px; background:#ffffff; border-radius:12px; box-shadow:0px 4px 12px 0px rgba(0,0,0,0.16); padding:8px; min-width:232px;`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              class="flex items-center gap-2 w-full px-2 py-2 text-14-regular text-left rounded-lg transition-colors hover:bg-[rgba(25,25,25,0.06)]"
              style="color: #0a59f7;"
              onClick={() => { newSession(); closeDropdown() }}
            >
              <div style="width:24px;height:24px;border-radius:3px;background:rgba(10,89,247,0.10);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                <div style="width:20px;height:20px;background-image:url('/insightIcon.svg');background-size:20px 20px;background-repeat:no-repeat;background-position:center;" />
              </div>
              <span style="font-weight:600">Octo Insight</span>
            </button>
            <button
              type="button"
              class="flex items-center gap-2 w-full px-2 py-2 text-14-regular text-left rounded-lg transition-colors hover:bg-[rgba(25,25,25,0.06)]"
              style="color: #6c00ff;"
              onClick={() => { newMakeSession(); closeDropdown() }}
            >
              <div style="width:24px;height:24px;border-radius:3px;background:rgba(108,0,255,0.10);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                <div style="width:20px;height:20px;background-image:url('/makeIcon.svg');background-size:20px 20px;background-repeat:no-repeat;background-position:center;" />
              </div>
              <span style="font-weight:600">Octo Make</span>
            </button>
          </div>
        </Show>
        <div style={{ height: "1px", background: "rgba(0,0,0,0.08)" }} />
      </div>

      {/* Scrollable: Insight + Make sessions */}
      <div
        data-slot="list-scroll"
        class="flex-1 min-h-0 overflow-y-auto mt-2"
        style={{ "scrollbar-width": "none" }}
      >
        {/* ─── Octo Insight ─── */}
        <div class="mb-[2px]">
          <button
            type="button"
            onClick={() => setInsightCollapsed((v) => !v)}
            class="flex items-center gap-3 w-full px-3 py-2 text-left"
          >
            <img src="/insightIcon.svg" alt="" style={{ width: "20px", height: "20px", "flex-shrink": "0" }} />
            <span class="flex-1 min-w-0 leading-6" style={{ color: "#191919", "font-size": "14px", "font-weight": "600" }}>
              Octo Insight
            </span>
            <ChevronRightIcon collapsed={insightCollapsed()} />
          </button>

          <Show when={!insightCollapsed()}>
            <div class="flex flex-col">
              <Show
                when={insightStable()}
                fallback={
                  <div class="px-3 py-[8px]">
                    <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                  </div>
                }
              >
                <Show
                  when={sessionList.length > 0}
                  fallback={
                    <div class="px-3 py-[8px] text-[12px] leading-[20px]" style={{ color: "#6e737a" }}>
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
                      return (
                        <div class="group/item relative">
                          <button
                            type="button"
                            onClick={() => {
                              notification.session.markViewed(session.id)
                              navigate(`/insight/${session.id}`)
                            }}
                            class="w-full text-left pl-[44px] py-[8px] rounded-lg text-[12px] leading-[20px] transition-colors flex items-center relative"
                            style={{
                              background: isActive() ? "rgba(10,89,247,0.08)" : "transparent",
                              color: isActive() ? "#0A59F7" : "#191919",
                              "padding-right": isActive() ? "20px" : "12px",
                            }}
                            classList={{ "hover:bg-surface-base-hover": !isActive() }}
                          >
                            <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
                              <div class="absolute left-3 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center">
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
                            <span class="truncate block w-full">{sessionTitle(session.title) || "无标题"}</span>
                          </button>
                          <Show when={isActive()}>
                            <span
                              class="absolute rounded-sm pointer-events-none"
                              style={{
                                right: "8px",
                                top: "4px",
                                width: "4px",
                                height: "28px",
                                background: "var(--text-interactive-base)",
                              }}
                            />
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>
        </div>

        {/* ─── Octo Make ─── */}
        <div class="mb-[2px]">
          <button
            type="button"
            onClick={() => setMakeCollapsed((v) => !v)}
            class="flex items-center gap-3 w-full px-3 py-2 text-left"
          >
            <img src="/makeIcon.svg" alt="" style={{ width: "20px", height: "20px", "flex-shrink": "0" }} />
            <span class="flex-1 min-w-0 leading-6" style={{ color: "#191919", "font-size": "14px", "font-weight": "600" }}>
              Octo Make
            </span>
            <ChevronRightIcon collapsed={makeCollapsed()} />
          </button>
          <Show when={!makeCollapsed()}>
            <div class="flex flex-col">
              <Show
                when={makeStable()}
                fallback={
                  <div class="px-3 py-[8px]">
                    <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                  </div>
                }
              >
                <Show
                  when={makeSessionList.length > 0}
                  fallback={
                    <div class="px-3 py-[8px] text-[12px] leading-[20px]" style={{ color: "#6e737a" }}>
                      {isOnboarding() ? "请先选择项目目录" : "暂无对话"}
                    </div>
                  }
                >
                  <For each={makeSessionList}>
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
                      return (
                        <div class="group/item relative">
                          <button
                            type="button"
                            onClick={() => {
                              notification.session.markViewed(session.id)
                              navigate(`/make/${session.id}`)
                            }}
                            class="w-full text-left pl-[44px] py-[8px] rounded-lg text-[12px] leading-[20px] transition-colors flex items-center relative"
                            style={{
                              background: isActive() ? "rgba(10,89,247,0.08)" : "transparent",
                              color: isActive() ? "#0A59F7" : "#191919",
                              "padding-right": isActive() ? "20px" : "12px",
                            }}
                            classList={{ "hover:bg-surface-base-hover": !isActive() }}
                          >
                            <Show when={isWorking() || hasPermissions() || hasError() || unseenCount() > 0}>
                              <div class="absolute left-3 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center">
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
                            <span class="truncate block w-full">{sessionTitle(session.title) || "无标题"}</span>
                          </button>
                          <Show when={isActive()}>
                            <span
                              class="absolute rounded-sm pointer-events-none"
                              style={{
                                right: "8px",
                                top: "4px",
                                width: "4px",
                                height: "28px",
                                background: "var(--text-interactive-base)",
                              }}
                            />
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Fixed bottom: 技能库 / 资产库 */}
      <div
        class="shrink-0 flex flex-col"
        style={{ "border-top": "1px solid rgba(0,0,0,0.08)", "padding-top": "6px" }}
      >
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () =>
              item.key === "skill_market"
                ? location.pathname === "/skills"
                : activeNav() === item.key
            return (
              <div class="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (item.key === "skill_market") {
                      navigate("/skills")
                    } else {
                      setActiveNav((v) => (v === item.key ? null : item.key))
                    }
                  }}
                  title={item.label}
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
                  style={{
                    "font-size": "12px",
                    "line-height": "20px",
                    background: isActive() ? "rgba(10,89,247,0.08)" : "transparent",
                    color: isActive() ? "#0A59F7" : "#191919",
                    "padding-right": isActive() ? "20px" : "12px",
                  }}
                  classList={{ "hover:bg-surface-base-hover": !isActive() }}
                >
                  <span class="flex items-center justify-center shrink-0">
                    <Show when={isActive()} fallback={<item.Icon size={16} />}>
                      <item.IconActive size={16} />
                    </Show>
                  </span>
                  <span class="whitespace-nowrap">{item.label}</span>
                </button>
                <Show when={isActive()}>
                  <span
                    class="absolute rounded-sm pointer-events-none"
                    style={{
                      right: "8px",
                      top: "4px",
                      width: "4px",
                      height: "28px",
                      background: "var(--text-interactive-base)",
                    }}
                  />
                </Show>
              </div>
            )
          }}
        </For>
      </div>

      {/* Settings */}
      <div class="shrink-0">
        <button
          type="button"
          class="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-text-strong hover:bg-surface-base-hover transition-colors"
          style={{ "font-size": "12px", "line-height": "20px" }}
          onClick={() => dialog.show(() => <DialogSettings />)}
        >
          <IconSettings size={16} />
          <span>设置</span>
        </button>
      </div>
    </div>
  )
}
