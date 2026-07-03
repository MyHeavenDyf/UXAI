import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { DialogSettings } from "@/components/dialog-settings"
import { sessionTitle } from "@/utils/session-title"
import { decode64 } from "@/utils/base64"

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

export function StudioHistory(props: { directory: string; routeSlug: string; activeSessionID?: string; onNewConversation: () => void; toggleDrawer?: () => void }): JSX.Element {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const layout = useLayout()

  const [sessions, { refetch }] = createResource(
    () => props.directory ?? "",
    async (dir) => {
      if (!dir) return [] as Session[]
      const client = globalSDK.createClient({ directory: dir })
      const result = await client.session.list()
      const data = ((result.data ?? []) as Session[])
        .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      return data.filter(s => s.agent === "octo_studio" && !s.time?.archived)
    },
  )
  const [sessionList, setSessionList] = createStore<Session[]>([])
  createEffect(on(sessions, (data) => {
    if (data) {
      setSessionList(reconcile(data, { key: "id" }))
      if (pendingScrollRestore > 0 && listScrollRef) {
        listScrollRef.scrollTop = pendingScrollRestore
        pendingScrollRestore = 0
      }
    }
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

  const isLoading = createMemo(() => sessions.loading)
  const [collapsed, setCollapsed] = createSignal(false)
  const [title, setTitle] = createStore({
    draft: "",
    editingID: "",
    savingID: "",
  })
  const [contextMenu, setContextMenu] = createStore<{
    show: boolean
    x: number
    y: number
    session: Session | null
  }>({ show: false, x: 0, y: 0, session: null })

  function closeContextMenu() {
    setContextMenu("show", false)
  }
  let titleRef: HTMLInputElement | undefined
  let listScrollRef: HTMLDivElement | undefined
  let pendingScrollRestore = 0

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const openTitleEditor = (session: Session) => {
    setTitle({
      draft: sessionTitle(session.title) ?? "",
      editingID: session.id,
    })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (title.savingID) return
    setTitle({ editingID: "", draft: "" })
  }

  const saveTitleEditor = async (session: Session) => {
    if (title.savingID) return

    const next = title.draft.trim()
    if (!next || next === (sessionTitle(session.title) ?? "")) {
      setTitle({ editingID: "", draft: "" })
      return
    }

    setTitle("savingID", session.id)
    await globalSDK.createClient({ directory: props.directory }).session
      .update({ sessionID: session.id, title: next })
      .then(() => {
        setSessionList(
          produce((draft) => {
            const index = draft.findIndex((item) => item.id === session.id)
            if (index !== -1) draft[index].title = next
          }),
        )
        setTitle({ editingID: "", draft: "" })
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
      .finally(() => setTitle("savingID", ""))
  }

  const navigateAfterSessionRemoval = (sessionID: string, nextSessionID?: string) => {
    if (props.activeSessionID !== sessionID) return
    if (nextSessionID) {
      navigate(`/${props.routeSlug}/studio/${nextSessionID}`)
      return
    }
    const decoded = decode64(props.routeSlug)
    if (decoded) layout.lastSessionPerTab.setStudio(decoded, "")
    navigate(`/${props.routeSlug}/studio`)
  }

  const deleteSession = async (session: Session) => {
    const sessions = sessionList.filter((item) => !item.time?.archived)
    const index = sessions.findIndex((item) => item.id === session.id)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await globalSDK.createClient({ directory: props.directory }).session
      .delete({ sessionID: session.id })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    pendingScrollRestore = listScrollRef?.scrollTop ?? 0
    setSessionList(
      produce((draft) => {
        const index = draft.findIndex((item) => item.id === session.id)
        if (index !== -1) draft.splice(index, 1)
      }),
    )
    // 恢复滚动位置（produce 后同步尝试，reconcile 后也会恢复）
    if (listScrollRef && pendingScrollRestore > 0) {
      listScrollRef.scrollTop = pendingScrollRestore
    }
    navigateAfterSessionRemoval(session.id, nextSession?.id)
    return true
  }

  function DialogDeleteSession(props: { session: Session }) {
    const name = createMemo(() => sessionTitle(props.session.title) ?? language.t("command.session.new"))
    const handleDelete = async () => {
      await deleteSession(props.session)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit class="delete-dialog">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" class="delete-dialog-btn delete-dialog-btn-primary" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <div
      class="h-full flex flex-col"
      style={{
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        padding: "12px 12px 24px 12px",
      }}
    >
      <div class="flex-1 min-h-0 flex flex-col">
        {/* New session button + divider */}
        <div class="flex flex-col gap-2 shrink-0">
          <div class="flex items-center">
            <button
              type="button"
              class="flex items-center gap-3 flex-1 rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
              style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
              onClick={props.onNewConversation}
            >
              <Icon name="plus" size="normal" class="shrink-0" />
              <span>{language.t("command.session.new")}</span>
            </button>
            <Show when={typeof props.toggleDrawer === 'function'}>
              <button
                type="button"
                class="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(25,25,25,0.06)] shrink-0"
                style={{ width: "36px", height: "36px" }}
                onClick={(e) => { e.stopPropagation(); props.toggleDrawer!(); }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="15" viewBox="0 0 12 15" fill="none" class="shrink-0">
                  <rect x="0.5" y="0.5" width="11" height="14" rx="2" stroke="#000000" />
                  <line x1="2.67" y1="0.5" x2="2.67" y2="14.5" stroke="#000000" />
                </svg>
              </button>
            </Show>
          </div>
          <div style={{ height: "1px", background: "rgba(0,0,0,0.1)" }} />
        </div>

        {/* Collapsible section header */}
        <div class="flex items-center h-[36px] px-[12px] mt-[8px]">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
          >
            <span class="flex items-center gap-[12px]">
              <img src="/studio/IconStudio1.svg" alt="" style={{ width: "20px", height: "20px" }} />
              <span class="text-[12px] leading-[20px] select-none" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                Octo Studio
              </span>
            </span>
            <ChevronRightIcon collapsed={collapsed()} />
          </button>
        </div>

        {/* Session list */}
        <Show when={!collapsed()}>
        <div class="flex flex-col flex-1 min-h-0">
          <div data-slot="list-scroll" ref={listScrollRef!} class="flex-1 min-h-0 overflow-y-auto" style={{ "margin-right": "-12px", "padding-right": "12px"}}>
            <Show when={!isLoading()} fallback={
              <div class="text-12-regular text-text-weak py-4 text-center">
                <Spinner class="size-4 mx-auto mb-1" />
                {language.t("common.loading")}
              </div>
            }>
              <Show
                when={sessionList.length > 0}
                fallback={
                  <div class="text-12-regular text-text-weak py-4 text-center">
                    {language.t("sidebar.history.empty")}
                  </div>
                }
              >
                <div class="flex flex-col">
                  <For each={sessionList}>
                    {(session) => {
                      const isActive = () => props.activeSessionID === session.id
                      const isContextTarget = () => contextMenu.show && contextMenu.session?.id === session.id
                      const [isTruncated, setIsTruncated] = createSignal(false)
                      let titleSpanRef!: HTMLSpanElement
                      let titleResizeObserver: ResizeObserver | undefined
                      const checkTruncation = () => {
                        if (titleSpanRef) setIsTruncated(titleSpanRef.scrollWidth > titleSpanRef.clientWidth)
                      }
                      createEffect(() => {
                        const _title = sessionTitle(session.title) ?? language.t("command.session.new")
                        void _title
                        queueMicrotask(() => checkTruncation())
                      })
                      onCleanup(() => titleResizeObserver?.disconnect())
                      const [showTooltip, setShowTooltip] = createSignal(false)
                      let tooltipTimeout: ReturnType<typeof setTimeout> | undefined
                      let tooltipRef!: HTMLDivElement
                      const [tooltipStyle, setTooltipStyle] = createSignal<JSX.CSSProperties>({})
                      const updateTooltipPos = () => {
                        if (!titleSpanRef) return
                        const rect = titleSpanRef.getBoundingClientRect()
                        const spaceBelow = window.innerHeight - rect.bottom
                        const style: JSX.CSSProperties = { left: `${rect.left}px` }
                        if (spaceBelow >= 130 || spaceBelow >= rect.top) {
                          style.top = `${rect.bottom + 4}px`
                        } else {
                          style.bottom = `${window.innerHeight - rect.top + 4}px`
                        }
                        setTooltipStyle(style)
                      }
                      const enterTrigger = () => {
                        if (!isTruncated()) return
                        clearTimeout(tooltipTimeout)
                        updateTooltipPos()
                        setShowTooltip(true)
                      }
                      const leaveTrigger = () => {
                        tooltipTimeout = setTimeout(() => setShowTooltip(false), 150)
                      }
                      const enterTooltip = () => clearTimeout(tooltipTimeout)
                      const leaveTooltip = () => setShowTooltip(false)
                      return (
                        <div class="relative">
                          <Show
                            when={title.editingID === session.id}
                            fallback={
                              <>
                                <a
                                  href={`/${props.routeSlug}/studio/${session.id}`}
                                  class="flex items-center w-full rounded-[8px] transition-colors"
                                  style={{ height: "36px", padding: "0 44px 0 44px", "font-size": "12px", "line-height": "20px", color: isActive() ? "#0A59F7" : undefined }}
                                  classList={{
                                    "bg-[rgba(10,89,247,0.08)]": isActive(),
                                    "hover:bg-surface-base-hover": !isActive() && !isContextTarget(),
                                    "bg-[rgba(0,0,0,0.06)]": isContextTarget(),
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault()
                                    setContextMenu({ show: true, x: e.clientX, y: e.clientY, session })
                                  }}
                                  onMouseEnter={enterTrigger}
                                  onMouseLeave={leaveTrigger}
                                >
                                  <span ref={(el) => { titleSpanRef = el; titleResizeObserver?.disconnect(); titleResizeObserver = new ResizeObserver(() => checkTruncation()); titleResizeObserver.observe(el); queueMicrotask(() => checkTruncation()) }} class="flex-1 min-w-0 truncate">
                                    {sessionTitle(session.title) ?? language.t("command.session.new")}
                                  </span>
                                </a>
                                <Show when={showTooltip()}>
                                  <Portal>
                                    <div
                                      ref={tooltipRef!}
                                      style={tooltipStyle()}
                                      onMouseEnter={enterTooltip}
                                      onMouseLeave={leaveTooltip}
                                      class="studio-custom-tooltip fixed z-[1000]"
                                    >
                                      {sessionTitle(session.title) ?? language.t("command.session.new")}
                                    </div>
                                  </Portal>
                                </Show>
                              </>
                            }
                          >
                            <div
                              class="flex items-center w-full rounded-[8px]"
                              style={{ height: "36px", padding: "0 44px 0 44px", "font-size": "12px", "line-height": "20px", color: isActive() ? "#0A59F7" : undefined, background: isActive() ? "rgba(10,89,247,0.08)" : undefined }}
                            >
                              <InlineInput
                                ref={(el) => {
                                  titleRef = el
                                }}
                                value={title.draft}
                                disabled={title.savingID === session.id}
                                class="text-[12px] leading-[20px] flex-1 min-w-0 rounded-[6px]"
                                onInput={(event) => setTitle("draft", event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  event.stopPropagation()
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    void saveTitleEditor(session)
                                    return
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault()
                                    closeTitleEditor()
                                  }
                                }}
                                onBlur={() => void saveTitleEditor(session)}
                              />
                            </div>
                          </Show>
                          <Show when={isActive() && title.editingID !== session.id}>
                            <span
                              class="absolute rounded-full pointer-events-none"
                              style={{
                                right: "4px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                width: "4px",
                                height: "28px",
                                background: "#0A59F7",
                              }}
                            />
                          </Show>
                          <Show when={contextMenu.show && contextMenu.session?.id === session.id}>
                            <Portal>
                              <div
                                class="fixed inset-0" style={{"z-index": "150"}}
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
                                    "z-index": "151",
                                    left: `${contextMenu.x}px`,
                                    ...(contextMenu.y > window.innerHeight - 120
                                      ? { bottom: `${window.innerHeight - contextMenu.y}px` }
                                      : { top: `${contextMenu.y}px` }),
                                    transform: "translateX(12px)",
                                    "min-width": "132px",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    data-slot="dropdown-menu-item"
                                    onClick={() => {
                                      closeContextMenu()
                                      openTitleEditor(session)
                                    }}
                                  >
                                    <span data-slot="dropdown-menu-item-label">重命名</span>
                                  </button>
                                  <div data-slot="dropdown-menu-separator" />
                                  <button
                                    data-slot="dropdown-menu-item"
                                    onClick={() => {
                                      closeContextMenu()
                                      dialog.show(() => <DialogDeleteSession session={session} />)
                                    }}
                                  >
                                    <span data-slot="dropdown-menu-item-label">删除</span>
                                  </button>
                                </div>
                              </div>
                            </Portal>
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

      <button
        type="button"
        class="flex items-center gap-3 w-full rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
        style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
        onClick={() => dialog.show(() => <DialogSettings />)}
      >
        <Icon name="settings-gear" size="small" class="shrink-0" />
        <span class="text-[14px] leading-[22px]">{language.t("sidebar.settings")}</span>
      </button>
    </div>
  )
}
