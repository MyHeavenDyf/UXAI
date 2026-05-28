import { Show, createResource, createEffect, For, on, onCleanup, createSignal, type JSX } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { A, useParams, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { Spinner } from "@opencode-ai/ui/spinner"

function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20" width="20.000000" height="20.000000" fill="none">
      <rect id="chevron_down" width="20.000000" height="20.000000" x="0.000000" y="0.000000"/>
      <rect id="矩形 9" width="20.000000" height="20.000000" x="0.000000" y="0.000000" opacity="0" fill="rgb(0,0,0)"/>
      <g id="组合 10">
        <path id="矢量 13" d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgb(0,0,0)" fill-opacity="0.600000024" fill-rule="nonzero"/>
      </g>
    </svg>
  )
}

export function Sidebar(props: {
  currentDir: () => string | null
  newTarget?: string
  onOpenSettings?: () => void
}) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()

  const [sessions, { refetch }] = createResource(
    () => props.currentDir() ?? "",
    async (d) => {
      if (!d) return [] as Session[]
      const client = globalSDK.createClient({ directory: d })
      const result = await client.session.list()
      const data = ((result.data ?? []) as Session[])
        .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      return data.filter(s => s.agent === "octo_ai")
    },
  )
  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) setSessionList(reconcile(data, { key: "id" }))
  }, { defer: true }))

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

  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <div
      class="flex h-full w-full flex-col"
      style={{
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        padding: "12px 12px 24px 12px",
      }}
    >
      <Show when={props.currentDir()}>
        <div class="flex-1 min-h-0 flex flex-col">
          {/* New session button + divider */}
          <div class="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              class="flex items-center gap-3 w-full rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
              style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
              onClick={() => {
                const dir = props.currentDir()
                if (!dir) return
                navigate(`/${base64Encode(dir)}/${props.newTarget ?? "chat"}?hint=${Date.now()}`)
              }}
            >
              <Icon name="plus" size="normal" class="shrink-0" />
              <span>{language.t("command.session.new")}</span>
            </button>
            <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 0" }} />
          </div>
          {/* Collapsible section header */}
          <div class="flex items-center h-[36px] pl-[12px] pr-[16px] mt-[8px]">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
            >
              <span class="flex items-center gap-[12px]">
                <img src="/IconChat1.svg" alt="" style={{ width: "20px", height: "20px" }} />
                <span class="text-[12px] leading-[20px] font-bold" style={{ color: "var(--text-strong)", "font-weight": 600 }}>
                  Octo Chat
                </span>
              </span>
              <ChevronRightIcon collapsed={collapsed()} />
            </button>
          </div>
          {/* Session list */}
          <Show when={!collapsed()}>
          <div class="flex flex-col flex-1 min-h-0">
            <div data-slot="list-scroll" class="flex-1 min-h-0 overflow-y-auto" style={{ "margin-right": "-12px", "padding-right": "12px", "padding-bottom": "12px"}}>
              <Show when={!sessions.loading} fallback={
                <div class="text-12-regular text-text-weak py-4 text-center">
                  <Spinner class="size-4 mx-auto mb-1" />
                  {language.t("common.loading")}
                </div>
              }>
                <Show
                  when={sessionList.length > 0}
                  fallback={
                    <div class="text-12-regular text-text-weak py-4 text-center">
                      {language.t("session.review.empty")}
                    </div>
                  }
                >
                <div class="flex flex-col">
                  <For each={sessionList}>
                    {(session) => {
                      const isActive = () => params.id === session.id
                      return (
                        <div class="group/item relative">
                          <A
                            href={`/${base64Encode(session.directory)}/chat/${session.id}`}
                            activeClass=""
                            class="flex items-center w-full rounded-[8px] transition-colors"
                            style={{ height: "36px", padding: "0 24px 0 44px", "font-size": "12px", "line-height": "20px", color: isActive() ? "#0A59F7" : undefined }}
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
                                right: "12px",
                                top: "50%",
                                transform: "translate(-50%, -50%)",
                                width: "4px",
                                height: "28px",
                                background: "#0A59F7",
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
                                <Icon name="archive" size="normal" />
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
            </div>
          </div>
          </Show>
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
