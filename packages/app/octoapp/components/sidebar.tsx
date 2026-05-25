import { Show, createMemo, For } from "solid-js"
import { produce } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { A, useParams, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { sortedRootSessions } from "@/pages/layout/helpers"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { Spinner } from "@opencode-ai/ui/spinner"

type TabType = "chat" | "cowork" | "studio"

const TAB_META: Record<TabType, { label: string; icon: string }> = {
  chat: { label: "Chat", icon: "/IconChat1.svg" },
  cowork: { label: "Cowork", icon: "/IconCowork1.svg" },
  studio: { label: "Studio", icon: "/IconStudio1.svg" },
}

export function Sidebar(props: {
  currentDir: () => string | null
  activeTab: () => TabType
  newTarget?: string
  onOpenSettings?: () => void
}) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const sortNow = createMemo(() => Date.now())

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]
    const client = globalSDK.createClient({ directory: session.directory })
    await client.session.update({
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft: { session: Session[] }) => {
        const match = Binary.search(draft.session, session.id, (s: Session) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/chat/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/chat`)
      }
    }
  }

  const openSettings = () => {
    if (props.onOpenSettings) {
      props.onOpenSettings()
      return
    }
    dialog.show(() => <DialogSettings />)
  }

  const tabMeta = createMemo(() => TAB_META[props.activeTab()])

  return (
    <div
      class="flex h-full w-full flex-col gap-6"
      style={{
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        padding: "12px",
      }}
    >
      <Show when={props.currentDir()}>
        <div class="flex-1 min-h-0 flex flex-col gap-3">
          {/* Top controls: new button + divider + section header */}
          <div class="flex flex-col gap-2 shrink-0">
            {/* New session button — no default background */}
            <button
              type="button"
              class="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-14-regular text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
              style={{ height: "44px", color: "#191919" }}
              onClick={() => {
                const dir = props.currentDir()
                if (!dir) return
                navigate(`/${base64Encode(dir)}/${props.newTarget ?? "chat"}?hint=${Date.now()}`)
              }}
            >
              <Icon name="plus" size="small" class="shrink-0" />
              <span>{language.t("command.session.new")}</span>
            </button>
            {/* Divider */}
            <div style={{ height: "1px", background: "rgba(0,0,0,0.08)", margin: "0 0" }} />
            {/* Section header: tab icon + label */}
            <div class="flex items-center gap-3 px-3 py-2">
              <img src={tabMeta().icon} alt="" style={{ width: "16px", height: "16px" }} />
              <span
                class="flex-1 min-w-0 leading-6"
                style={{ color: "#191919", "font-size": "16px", "font-weight": "700" }}
              >
                {tabMeta().label}
              </span>
            </div>
          </div>
          {/* 历史记录 */}
          <div class="shrink-0">
            <div class="sidebar-history-title">历史记录</div>
            {/* 搜索栏已移至 titlebar，保留此代码以备后续使用 */}
            {/* <div class="sidebar-history-search-wrap">
              <svg class="sidebar-history-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5" />
                <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
              <input
                type="text"
                class="sidebar-history-search-input"
                placeholder="搜索历史记录"
              />
            </div> */}
          </div>
          {/* Session list */}
          <div class="flex flex-col gap-1 flex-1 min-h-0">
            <div data-slot="list-scroll" class="flex-1 min-h-0 overflow-y-auto" style={{ "margin-right": "-12px", "padding-right": "12px"}}>
              <Show when={props.currentDir()} keyed>
                {(dir) => {
                  const [store] = globalSync.child(dir, { bootstrap: true })
                  const sessions = createMemo(() => sortedRootSessions(store, sortNow()))
                  const octoAiSessions = createMemo(() => sessions().filter(s => s.agent === "octo_ai"))
                  const isLoading = createMemo(() => store.status === "loading")
                  return (
                    <Show when={!isLoading()} fallback={
                      <div class="text-12-regular text-text-weak py-4 text-center">
                        <Spinner class="size-4 mx-auto mb-1" />
                        {language.t("common.loading")}
                      </div>
                    }>
                      <Show
                        when={octoAiSessions().length > 0}
                        fallback={
                          <div class="text-12-regular text-text-weak py-4 text-center">
                            {language.t("session.review.empty")}
                          </div>
                        }
                      >
                      <div class="flex flex-col gap-1">
                        <For each={octoAiSessions()}>
                          {(session) => {
                            const isActive = () => params.id === session.id
                            return (
                              <div class="group/item relative">
                                <A
                                  href={`/${base64Encode(dir)}/chat/${session.id}`}
                                  activeClass=""
                                  class="flex items-center w-full px-3 py-2 rounded-lg text-14-regular text-text-strong transition-colors"
                                  style={{ "padding-right": isActive() ? "20px" : "12px" }}
                                  classList={{
                                    "bg-[rgba(10,89,247,0.08)]": isActive(),
                                    "hover:bg-surface-base-hover": !isActive(),
                                  }}
                                >
                                  <span class="flex-1 min-w-0 truncate">
                                    {sessionTitle(session.title) ?? language.t("command.session.new")}
                                  </span>
                                </A>
                                {/* Active right indicator bar */}
                                <Show when={isActive()}>
                                  <span
                                    class="absolute rounded-full pointer-events-none"
                                    style={{
                                      right: "8px",
                                      top: "50%",
                                      transform: "translateY(-50%)",
                                      width: "4px",
                                      height: "32px",
                                      background: "var(--text-interactive-base)",
                                    }}
                                  />
                                </Show>
                                {/* Archive on hover (non-active only) */}
                                <Show when={!isActive()}>
                                  <div class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 transition-opacity pointer-events-none group-hover/item:pointer-events-auto" style="display: none">
                                    <button
                                      type="button"
                                      class="size-5 rounded flex items-center justify-center hover:bg-surface-raised-base-hover text-icon-weak"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        void archiveSession(session)
                                      }}
                                      aria-label={language.t("common.archive")}
                                    >
                                      <Icon name="archive" size="small" />
                                    </button>
                                  </div>
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </Show>
                    </Show>
                  )
                }}
              </Show>
            </div>
          </div>
        </div>

        {/* Settings button */}
        <button
          type="button"
          class="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-14-regular text-text-strong shrink-0 hover:bg-surface-base-hover transition-colors"
          style={{ "font-size": "14px", "line-height": "20px", padding: "8px 12px" }}
          onClick={openSettings}
        >
          <Icon name="settings-gear" size="small" class="shrink-0" />
          <span style={{ "line-height": "20px" }}>{language.t("sidebar.settings")}</span>
        </button>
      </Show>
    </div>
  )
}
