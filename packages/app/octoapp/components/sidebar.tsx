import { Show, createMemo, For } from "solid-js"
import { produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useParams, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { SessionItem, type SessionItemProps } from "@/pages/layout/sidebar-items"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { sortedRootSessions, groupSessionsByDate } from "@/pages/layout/helpers"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { DialogSettings } from "@/components/dialog-settings"

type TabType = "chat" | "cowork" | "studio"

const TAB_ITEMS: { key: TabType; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "cowork", label: "Cowork" },
  { key: "studio", label: "Studio" },
]

export function Sidebar(props: {
  currentDir: () => string | null
  activeTab: () => TabType
  onOpenSettings?: () => void
}) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const sortNow = createMemo(() => Date.now())

  console.log("[Sidebar] currentDir:", props.currentDir())

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

  const sidebarOpened = () => layout.sidebar.opened()

  const sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense"> = {
    navList: createMemo(() => []),
    sidebarExpanded: sidebarOpened,
    clearHoverProjectSoon: () => {},
    prefetchSession: () => {},
    archiveSession,
  }

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden bg-background-base flex-col">
      <Show when={props.currentDir()}>
        <div class="shrink-0 px-3 pt-3 pb-2">
          <div class="text-14-medium text-text-strong mb-2">
            {TAB_ITEMS.find((t) => t.key === props.activeTab())?.label ?? ""}
          </div>
          <Button
            size="normal"
            icon="plus"
            variant="ghost"
            class="w-full justify-start border-0"
            onClick={() => {
              const dir = props.currentDir()
              if (!dir) return
              navigate(`/${base64Encode(dir)}/chat`)
            }}
          >
            {language.t("command.session.new")}
          </Button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-3">
          <Show when={props.currentDir()} keyed>
            {(dir) => {
              const [store] = globalSync.child(dir, { bootstrap: true })
              const sessions = createMemo(() => sortedRootSessions(store, sortNow()))
              const groupedSessions = createMemo(() => groupSessionsByDate(sessions(), sortNow()))
              return (
                <Show when={groupedSessions().length > 0} fallback={
                  <div class="text-12-regular text-text-weak py-4 text-center">
                    {language.t("session.review.empty")}
                  </div>
                }>
                  <For each={groupedSessions()}>
                    {(group) => (
                      <div class="mb-2">
                        <div class="text-12-medium text-text-weak pb-1">
                          {language.t(`session.group.${group.key}`)}
                        </div>
                        <For each={group.sessions}>
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
                      </div>
                    )}
                  </For>
                </Show>
              )
            }}
          </Show>
        </div>
        <div class="shrink-0 px-3 py-2 border-t border-border-weak-base">
          <Button
            icon="settings-gear"
            variant="ghost"
            class="w-full justify-start"
            onClick={openSettings}
            aria-label={language.t("sidebar.settings")}
          >
            {language.t("sidebar.settings")}
          </Button>
        </div>
      </Show>
    </div>
  )
}