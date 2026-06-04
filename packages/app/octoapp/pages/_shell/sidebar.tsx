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
import { useLayout } from "@/context/layout"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { Spinner } from "@opencode-ai/ui/spinner"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings, IconSettings1,
} from "./icons"
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
  const layout = useLayout()

  const projectDir = useProjectDir()

  // Resolved directory signal — the single source of truth for session loading.
  // Populated by two effects from different reliable reactive sources.
  const [resolvedDir, setResolvedDir] = createSignal<string>()

  const isOnboarding = createMemo(() => !resolvedDir())

  // Track which directory the fetched data came from, so we only show content
  // when the data matches the current directory (prevents flicker when dir changes from home → project)
  const [insightFetchedDir, setInsightFetchedDir] = createSignal<string>()

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
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  const [insightCollapsed, setInsightCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)

  function newSession() {
    const dir = resolvedDir()
    if (!dir) return
    const client = globalSDK.createClient({ directory: dir })
    void client.session.create({ directory: dir, agent: "octo_insight" }).then((result) => {
      const session = result.data as Session | undefined
      if (session) navigate(`/insight/${session.id}`)
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
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="shrink-0">
              <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
            <span>新建</span>
          </button>
        </div>
        <div style={{ height: "1px", background: "rgba(0,0,0,0.1)" }} />
      </div>
      {/* Scrollable: Insight + Make sessions */}
      <div
        data-slot="list-scroll"
        class="flex-1 min-h-0 overflow-y-auto px-[12px]"
      >
        {/* ─── Octo Insight ─── */}
        <div class="mb-[2px]">
          <div class="flex items-center h-[36px] px-[12px]">
            <button
              type="button"
              onClick={() => setInsightCollapsed((v) => !v)}
              class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
            >
              <span class="flex items-center gap-[12px] min-w-0">
                <img src="/insightIcon.svg" alt="" style={{ width: "20px", height: "20px" }} />
                <span class="text-[12px] leading-[20px] select-none truncate" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                  Octo Insight
                </span>
              </span>
              <ChevronRightIcon collapsed={insightCollapsed()} />
            </button>
          </div>

          <Show when={!insightCollapsed()}>
            <div class="flex flex-col">
              <Show
                when={insightStable()}
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
                      return (
                          <button
                            type="button"
                            onClick={() => {
                              notification.session.markViewed(session.id)
                              navigate(`/insight/${session.id}`)
                            }}
                            class="w-full text-left rounded-[8px] text-[12px] leading-[20px] transition-colors flex items-center relative"
                            style={{
                              height: "36px",
                              padding: "0 24px 0 44px",
                              color: isActive() ? "#0A59F7" : undefined,
                            }}
                            classList={{
                              "bg-[rgba(10,89,247,0.08)]": isActive(),
                              "hover:bg-surface-base-hover": !isActive(),
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
                    layout.sidebarSource.set("cowork")
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

      {/* Settings */}
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
    </div>
  )
}
