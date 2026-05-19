import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { Spinner } from "@opencode-ai/ui/spinner"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings, IconSettings1,
} from "./icons"

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

  const projectDir = useProjectDir()

  const [sessions, { refetch }] = createResource(projectDir, async (dir) => {
    if (!dir) return [] as Session[]
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.session.list()
    const data = ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
    return data.filter(s => s.agent === "octo_insight")
  })

  const [makeSessions, { refetch: refetchMake }] = createResource(projectDir, async (dir) => {
    if (!dir) return [] as Session[]
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.session.list()
    const data = ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
    return data.filter(s => s.agent === "octo_make")
  })

  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let refetchMakeTimer: ReturnType<typeof setTimeout> | undefined

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 300)
      clearTimeout(refetchMakeTimer)
      refetchMakeTimer = setTimeout(() => void refetchMake(), 300)
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

  function newSession() {
    navigate("/insight")
  }

  function newMakeSession() {
    navigate("/make")
  }

  return (
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: `${props.width}px`,
        background: "transparent",
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      {/* Scrollable: Insight + Make sessions */}
      <div
        class="flex-1 min-h-0 overflow-y-auto px-[12px] py-[6px]"
        style={{ "scrollbar-width": "none" }}
      >
        {/* ─── Octo Insight ─── */}
        <div class="mb-[2px]">
          {/* 分组标题行 */}
          <div class="flex items-center h-[32px] px-[4px]">
            <button
              type="button"
              onClick={() => setInsightCollapsed((v) => !v)}
              class="flex items-center gap-[4px] flex-1 min-w-0 text-left"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
            >
              <ChevronRightIcon collapsed={insightCollapsed()} />
              <span
                class="text-[12px] font-medium select-none leading-[20px]"
                style={{ color: "var(--octo-text-tertiary, #364153)" }}
              >
                Octo Insight
              </span>
            </button>
            <button
              type="button"
              onClick={newSession}
              title="新建 Insight 对话"
              class="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-brand-a8, rgba(0,103,209,0.08))"; e.currentTarget.style.color = "var(--octo-brand, #0067D1)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--octo-text-secondary, #777777)" }}
            >
              <PlusIcon />
            </button>
          </div>

          <Show when={!insightCollapsed()}>
            <div class="flex flex-col gap-[1px]">
              <Show
                when={!sessions.loading || sessions() !== undefined}
                fallback={
                  <div class="px-[8px] py-[6px]">
                    <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                  </div>
                }
              >
                <Show
                  when={(sessions() ?? []).length > 0}
                  fallback={
                    <div class="px-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                      暂无对话
                    </div>
                  }
                >
                  <For each={sessions() ?? []}>
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
                          onClick={() => navigate(`/insight/${session.id}`)}
                          class="w-full text-left px-[8px] rounded-[4px] text-[12px] leading-[20px] transition-colors flex items-center gap-2 relative"
                          style={{
                            height: "48px",
                            background: isActive() ? "var(--octo-brand-a8, rgba(10,89,247,0.08))" : "transparent",
                            color: isActive() ? "var(--octo-brand, rgba(10,89,247,1))" : "var(--octo-text-primary, #191919)",
                            "font-weight": isActive() ? "500" : "400",
                          }}
                          onMouseEnter={(e) => { if (!isActive()) { e.currentTarget.style.background = "var(--octo-brand-a8, rgba(10,89,247,0.08))"; e.currentTarget.style.color = "var(--octo-brand, rgba(10,89,247,1))" } }}
                          onMouseLeave={(e) => { if (!isActive()) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--octo-text-primary, #191919)" } }}
                        >
                          <Show when={isActive()}>
                            <span
                              class="absolute left-0 top-1/2 rounded-r-[3px]"
                              style={{
                                height: "16px",
                                width: "3px",
                                background: "var(--octo-brand, #0067D1)",
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
                          <span class="truncate block w-full">{sessionTitle(session.title) || "无标题"}</span>
                        </button>
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
          <div class="flex items-center h-[32px] px-[4px]">
            <button
              type="button"
              onClick={() => setMakeCollapsed((v) => !v)}
              class="flex items-center gap-[4px] flex-1 min-w-0 text-left"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
            >
              <ChevronRightIcon collapsed={makeCollapsed()} />
              <span
                class="text-[12px] font-medium select-none leading-[20px]"
                style={{ color: "var(--octo-text-tertiary, #364153)" }}
              >
                Octo Make
              </span>
            </button>
            <button
              type="button"
              onClick={newMakeSession}
              title="新建 Make 对话"
              class="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] transition-colors"
              style={{ color: "var(--octo-text-secondary, #777777)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-brand-a8, rgba(0,103,209,0.08))"; e.currentTarget.style.color = "var(--octo-brand, #0067D1)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--octo-text-secondary, #777777)" }}
            >
              <PlusIcon />
            </button>
          </div>
          <Show when={!makeCollapsed()}>
            <div class="flex flex-col gap-[1px]">
              <Show
                when={!makeSessions.loading || makeSessions() !== undefined}
                fallback={
                  <div class="px-[8px] py-[6px]">
                    <div class="h-[10px] w-[80px] rounded-[3px] animate-pulse" style={{ background: "rgba(0,0,0,0.08)" }} />
                  </div>
                }
              >
                <Show
                  when={(makeSessions() ?? []).length > 0}
                  fallback={
                    <div class="px-[8px] py-[5px] text-[12px] leading-[20px]" style={{ color: "var(--octo-text-secondary, #777777)" }}>
                      暂无对话
                    </div>
                  }
                >
                  <For each={makeSessions() ?? []}>
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
                          onClick={() => navigate(`/make/${session.id}`)}
                          class="w-full text-left px-[8px] rounded-[4px] text-[12px] leading-[20px] transition-colors flex items-center relative"
                          style={{
                            height: "48px",
                            background: isActive() ? "var(--octo-brand-a8, rgba(10,89,247,0.08))" : "transparent",
                            color: isActive() ? "var(--octo-brand, rgba(10,89,247,1))" : "var(--octo-text-primary, #191919)",
                            "font-weight": isActive() ? "500" : "400",
                          }}
                          onMouseEnter={(e) => { if (!isActive()) { e.currentTarget.style.background = "var(--octo-brand-a8, rgba(10,89,247,0.08))"; e.currentTarget.style.color = "var(--octo-brand, rgba(10,89,247,1))" } }}
                          onMouseLeave={(e) => { if (!isActive()) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--octo-text-primary, #191919)" } }}
                        >
                          <Show when={isActive()}>
                            <span
                              class="absolute left-0 top-1/2 rounded-r-[3px]"
                              style={{
                                height: "16px",
                                width: "3px",
                                background: "var(--octo-brand, #0067D1)",
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
                          <span class="truncate block w-full">{sessionTitle(session.title) || "无标题"}</span>
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
        class="shrink-0 flex flex-col gap-[2px] px-[8px] pt-[6px]"
        style={{ "border-top": "1px solid var(--octo-border-default, #E5E7EB)" }}
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
                  background: isActive() ? "var(--octo-surface-selected, #EFF6FF)" : "transparent",
                  color: isActive() ? "var(--octo-brand, #0067D1)" : "var(--octo-text-primary, #191919)",
                  "font-weight": isActive() ? "500" : "400",
                }}
                onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
                onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
              >
                <span class="flex items-center justify-center shrink-0">
                  <Show when={isActive()} fallback={<item.Icon size={16} />}>
                    <item.IconActive size={16} />
                  </Show>
                </span>
                <span class="whitespace-nowrap">{item.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute right-0 top-1/2 rounded-l-[3px]"
                    style={{
                      height: "20px",
                      width: "3px",
                      background: "var(--octo-brand, #0067D1)",
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
      <div class="shrink-0 px-[8px] py-[8px]">
        <button
          type="button"
          title="设置"
          class="w-full flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors"
          style={{ height: "36px", color: "var(--octo-text-primary, #191919)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
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
