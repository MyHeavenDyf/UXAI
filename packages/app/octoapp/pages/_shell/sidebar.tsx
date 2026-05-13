import type { Session } from "@opencode-ai/sdk/v2/client"
import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSettings } from "@/components/dialog-settings"

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      style={{
        transform: props.collapsed ? "rotate(0deg)" : "rotate(90deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M7.5 4.5L12.5 10L7.5 15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2" />
      <path d="M8 1.5V3M8 13V14.5M1.5 8H3M13 8H14.5M3.5 3.5L4.5 4.5M11.5 11.5L12.5 12.5M12.5 3.5L11.5 4.5M4.5 11.5L3.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  )
}

const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: SkillIcon },
  { key: "knowledge_base", label: "资产库", Icon: AssetIcon },
] as const

function isTitlePending(title: string): boolean {
  return /^New session/.test(title)
}

const SECTION_HEADER_STYLE = {
  height: "48px",
  padding: "13px 16px",
  "font-size": "14px",
  "font-weight": "700",
  color: "rgba(0,0,0,0.9)",
}

const SESSION_ITEM_STYLE: Record<string, string> = {
  height: "48px",
  padding: "13px 16px 13px 48px",
  color: "rgba(0,0,0,0.9)",
  "font-size": "14px",
}

const ACTIVE_BAR_STYLE: Record<string, string> = {
  width: "4px",
  height: "32px",
  background: "rgb(10,89,247)",
  "border-radius": "999px",
}

export function OctoSidebar(props: {
  width: number
  directory?: string
  slug?: string
  dataCoworkArea?: string
}): JSX.Element {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ id?: string; dir?: string }>()
  const dialog = useDialog()

  const homeDir = () => globalSync.data.path.home
  const targetDir = () => props.directory ?? homeDir()

  const [sessions, { refetch }] = createResource(targetDir, async (dir) => {
    if (!dir) return [] as Session[]
    const result = await globalSDK.client.session.list({ directory: dir })
    return ((result.data ?? []) as Session[]).sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
  })

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      void refetch()
    }
  })
  onCleanup(unsub)

  const activeSessionId = () => {
    if (props.slug) {
      return params.id
    }
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  const [insightCollapsed, setInsightCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)
  const [hoveredSessionId, setHoveredSessionId] = createSignal<string | null>(null)

  function newSession() {
    if (props.slug) {
      navigate(`/${props.slug}/cowork`)
    } else {
      navigate("/insight")
    }
  }

  function navigateToSession(sessionId: string) {
    if (props.slug) {
      navigate(`/${props.slug}/cowork/${sessionId}`)
    } else {
      navigate(`/insight/${sessionId}`)
    }
  }

  function openSettings() {
    dialog.show(() => <DialogSettings />)
  }

  return (
    <div
      class="shrink-0 flex flex-col h-full overflow-hidden"
      data-cowork-area={props.dataCoworkArea}
      style={{
        width: `${props.width}px`,
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      <div
        class="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: "24px 16px", "scrollbar-width": "none" }}
      >
        {/* ─── Octo Insight ─── */}
        <div>
          <div class="flex items-center" style={SECTION_HEADER_STYLE}>
            <div class="flex items-center gap-[12px] flex-1 min-w-0">
              <InsightIcon />
              <span class="select-none">Octo Insight</span>
            </div>
            <div class="flex items-center gap-[6px] shrink-0">
              <button
                type="button"
                onClick={newSession}
                title="新建 Insight 对话"
                class="w-[20px] h-[20px] flex items-center justify-center"
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                onClick={() => setInsightCollapsed((v) => !v)}
                class="w-[20px] h-[20px] flex items-center justify-center"
              >
                <ChevronRightIcon collapsed={insightCollapsed()} />
              </button>
            </div>
          </div>

          <Show when={!insightCollapsed()}>
            <Show
              when={!sessions.loading}
              fallback={
                <div style={{ padding: "13px 16px 13px 48px" }}>
                  <div style={{ height: "10px", width: "80px", "border-radius": "3px", background: "rgba(0,0,0,0.08)" }} class="animate-pulse" />
                </div>
              }
            >
              <Show
                when={(sessions() ?? []).length > 0}
                fallback={
                  <div style={{ padding: "13px 16px 13px 48px", "font-size": "14px", color: "rgba(0,0,0,0.45)" }}>
                    暂无对话
                  </div>
                }
              >
                <For each={sessions() ?? []}>
                  {(session) => {
                    const isActive = () => activeSessionId() === session.id
                    const pending = () => isTitlePending(session.title)
                    return (
                      <button
                        type="button"
                        onClick={() => navigateToSession(session.id)}
                        class="w-full text-left transition-colors flex items-center relative"
                        style={{
                          ...SESSION_ITEM_STYLE,
                          "border-radius": "8px",
                          background: isActive() ? "rgba(10,89,247,0.08)" : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive()) e.currentTarget.style.background = "rgba(10,89,247,0.08)"
                          setHoveredSessionId(session.id)
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive()) e.currentTarget.style.background = "transparent"
                          setHoveredSessionId(null)
                        }}
                      >
                        <Show
                          when={pending()}
                          fallback={<span class="truncate block w-full">{session.title || "无标题"}</span>}
                        >
                          <span
                            class="animate-pulse"
                            style={{
                              width: "72px",
                              height: "10px",
                              "border-radius": "3px",
                              background: isActive() ? "rgba(10,89,247,0.2)" : "rgba(0,0,0,0.1)",
                            }}
                          />
                        </Show>
                        <Show when={isActive() || hoveredSessionId() === session.id}>
                          <span
                            class="absolute"
                            style={{
                              ...ACTIVE_BAR_STYLE,
                              right: "8px",
                              top: "50%",
                              transform: "translateY(-50%)",
                            }}
                          />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Show>
        </div>

        {/* ─── Octo Make ─── */}
        <div>
          <div class="flex items-center" style={SECTION_HEADER_STYLE}>
            <div class="flex items-center gap-[12px] flex-1 min-w-0">
              <MakeIcon />
              <span class="select-none">Octo Make</span>
            </div>
            <button
              type="button"
              title="新建 Make 对话"
              class="w-[20px] h-[20px] flex items-center justify-center shrink-0"
            >
              <PlusIcon />
            </button>
          </div>
        </div>

        {/* 分割线 */}
        <div style={{ margin: "12px 0px", height: "1px", background: "rgba(0,0,0,0.1)" }} />

        {/* 技能库 / 资产库 */}
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () => activeNav() === item.key
            return (
              <button
                type="button"
                onClick={() => setActiveNav((v) => (v === item.key ? null : item.key))}
                title={item.label}
                class="w-full text-left transition-colors flex items-center relative"
                style={{
                  height: "48px",
                  padding: "13px 16px",
                  "font-size": "14px",
                  "border-radius": "8px",
                  background: isActive() ? "rgba(10,89,247,0.08)" : "transparent",
                  color: isActive() ? "rgb(10,89,247)" : "rgba(0,0,0,0.9)",
                  "font-weight": isActive() ? "600" : "400",
                }}
                onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "rgba(10,89,247,0.08)" }}
                onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
              >
                <span class="flex items-center justify-center shrink-0" style={{ width: "20px", height: "20px" }}>
                  <item.Icon />
                </span>
                <span style={{ "margin-left": "12px" }}>{item.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute"
                    style={{
                      ...ACTIVE_BAR_STYLE,
                      right: "8px",
                      top: "50%",
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
          onClick={openSettings}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-surface-hover, #F5F5F5)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        >
          <SettingsIcon />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>
    </div>
  )
}
