import { createSignal, Show, type ParentProps, createMemo, createEffect, For } from "solid-js"
import { produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { TitlebarSimple } from "@/components/titlebar-simple"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate, useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { SessionItem, type SessionItemProps } from "@/pages/layout/sidebar-items"
import { useSessionKey } from "@/pages/session/session-layout"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { sortedRootSessions } from "@/pages/layout/helpers"
import type { Session } from "@opencode-ai/sdk/v2/client"

type TabType = "chat" | "cowork" | "studio"

const TAB_ITEMS: { key: TabType; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "cowork", label: "Cowork" },
  { key: "studio", label: "Studio" },
]

function SimpleSidebar(props: {
  currentDir: () => string | null
  opened: () => boolean
  onOpenSettings: () => void
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  globalSync: ReturnType<typeof useGlobalSync>
  globalSDK: ReturnType<typeof useGlobalSDK>
  navigate: ReturnType<typeof useNavigate>
  activeTab: () => TabType
}) {
  const params = useParams()
  const globalSync = props.globalSync
  const globalSDK = props.globalSDK
  const sortNow = createMemo(() => Date.now())

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        props.navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        props.navigate(`/${params.dir}/session`)
      }
    }
  }

  const sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense"> = {
    navList: createMemo(() => []),
    sidebarExpanded: props.opened,
    clearHoverProjectSoon: () => {},
    prefetchSession: () => {},
    archiveSession,
  }

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden bg-background-base flex flex-col">
      <Show when={props.currentDir()}>
        <div class="shrink-0">
          <div class="text-14-medium text-text-strong">
            {TAB_ITEMS.find((t) => t.key === props.activeTab())?.label ?? ""}
          </div>
          <div class="shrink-0 px-0">
            <Button
              size="normal"
              icon="plus"
              variant="ghost"
              class="w-full justify-start border-0 px-0"
              onClick={() => {
                const dir = props.currentDir()
                if (!dir) return
                props.navigate(`/${base64Encode(dir)}/session`)
              }}
            >
              {props.language.t("command.session.new")}
            </Button>
          </div>
        </div>
        <div class="shrink-0">
          <div class="sidebar-history-title">历史记录</div>
          <div class="sidebar-history-search-wrap">
            <svg class="sidebar-history-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5" />
              <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
            <input
              type="text"
              class="sidebar-history-search-input"
              placeholder="搜索历史记录"
            />
          </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <Show when={props.currentDir()} keyed>
            {(dir) => {
              const [store] = globalSync.child(dir, { bootstrap: false })
              const sessions = createMemo(() => sortedRootSessions(store, sortNow()))
              return (
                <For each={sessions()}>
                  {(session) => (
                    <SessionItem
                      {...sessionProps}
                      session={session}
                      list={sessions()}
                      slug={base64Encode(dir)}
                      dense
                    />
                  )}
                </For>
              )
            }}
          </Show>
        </div>
        <div class="shrink-0">
          <Button
            icon="settings-gear"
            variant="ghost"
            class="w-full justify-start"
            onClick={props.onOpenSettings}
            aria-label={props.language.t("sidebar.settings")}
          >
            {props.language.t("sidebar.settings")}
          </Button>
        </div>
      </Show>
    </div>
  )
}

export default function LayoutNet(props: ParentProps) {
  const [activeTab, setActiveTab] = createSignal<TabType>("chat")
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const sessionKey = useSessionKey()

  const projects = () => layout.projects.list()

  const resolvedDirectory = createMemo(() => {
    if (params.dir) {
      const decoded = decode64(params.dir)
      if (decoded) return decoded
    }
    return null
  })

  createEffect(() => {
    if (!params.dir && projects().length > 0) {
      const firstProject = projects()[0]
      navigate(`/${base64Encode(firstProject.worktree)}/session`, { replace: true })
    }
  })

  createEffect(() => {
    const key = sessionKey.sessionKey()
    if (!key) return
    if (activeTab() === "cowork") {
      if (!layout.fileTree.opened()) layout.fileTree.open()
      const view = layout.view(key)
      if (!view.reviewPanel.opened()) view.reviewPanel.open()
    } else if (activeTab() === "chat") {
      if (layout.fileTree.opened()) layout.fileTree.close()
      const view = layout.view(key)
      if (view.reviewPanel.opened()) view.reviewPanel.close()
    }
  })

  const sidebarOpened = () => layout.sidebar.opened()

  const openSettings = () => {
    void import("@/components/dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  const sidebarContent = () => (
    <SimpleSidebar
      currentDir={resolvedDirectory}
      opened={sidebarOpened}
      onOpenSettings={openSettings}
      language={language}
      layout={layout}
      globalSync={globalSync}
      globalSDK={globalSDK}
      navigate={navigate}
      activeTab={activeTab}
    />
  )

return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <TitlebarSimple activeTab={activeTab} setActiveTab={setActiveTab} />
      <div class="flex-1 min-h-0 min-w-0 flex">
        <Show when={!params.dir}>
          {props.children}
        </Show>

        <Show when={params.dir && resolvedDirectory()} keyed>
          {(directory) => (
            <>
              <div classList={{
                "flex flex-1 min-w-0 min-h-0": activeTab() === "chat" || activeTab() === "cowork",
                "hidden": activeTab() === "studio",
              }}>
                <div class="w-[300px] shrink-0 border-r border-border-weak-base">
                  {sidebarContent()}
                </div>
                <div class="flex-1 min-w-0">
                  {props.children}
                </div>
              </div>

              <div classList={{
                "flex flex-1 min-w-0 items-center justify-center": activeTab() === "studio",
                "hidden": activeTab() !== "studio",
              }}>
                <span class="text-14-regular text-text-weak">Studio content placeholder</span>
              </div>
            </>
          )}
        </Show>

        <Show when={params.dir && !resolvedDirectory()}>
          <div class="flex-1 min-w-0 flex items-center justify-center">
            <span class="text-14-regular text-text-weak">Loading...</span>
          </div>
        </Show>
      </div>
    </div>
  )
}
