import "./make/octo-tokens.css"
import { createMemo, createEffect, on, Show, Suspense, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { tracker } from "@/utils/tracker"
import { AgentSidebar } from "@/components/agent-sidebar"
import { useLocal } from "@/context/local"
import { useTabModel } from "@/hooks/use-tab-model"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { decode64 } from "@/utils/base64"
import { persisted, Persist } from "@/utils/persist"
import { lazy } from "solid-js"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import type { Session } from "@opencode-ai/sdk/v2/client"

const SessionPage = lazy(() => import("@/pages/session"))

function SessionProviders(props: { children: JSX.Element }) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

export default function ChatPage() {
  const params = useParams<{ dir?: string; id?: string }>()
  const local = useLocal()
  useTabModel("chat")
  const layout = useLayout()
  const sdk = useSDK()

  const resolvedDirectory = createMemo(() => sdk.directory || null)

  onMount(() => {
    tracker.page({ module: "chat", name: "chat-page" })
    local.agent.set("octo_ai")
  })

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      ({ dir, id }) => {
        if (dir && id) {
          const decoded = decode64(dir)
          if (decoded) layout.lastSessionPerTab.setChat(decoded, id)
        }
      },
    ),
  )

  const [sidebarWidthStore, setSidebarWidthStore] = persisted(
    Persist.global("chat.sidebar.width"),
    createStore({ width: 300 }),
  )
  const sidebarWidth = () => sidebarWidthStore.width
  const setSidebarWidth = (w: number) => setSidebarWidthStore({ width: w })

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(200, Math.min(360, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div class="relative flex flex-1 min-w-0 min-h-0 h-full">
      <Show when={resolvedDirectory()}>
        <div
          class="sidebar-wrap h-full shrink-0 border-r border-border-weak-base flex flex-col"
          style={{ width: `${sidebarWidth()}px`, "z-index": 11 }}
        >
          <AgentSidebar
            width={sidebarWidth()}
            directory={resolvedDirectory()}
            agentFilter="octo_ai"
            showProjectInfo={false}
            showBottomNav={false}
            listParams={{ scope: "project", category: "dev" }}
            buildSessionRoute={(s: Session) => `/${base64Encode(s.directory)}/chat/${s.id}`}
            buildNewRoute={() => {
              const dir = resolvedDirectory()
              return dir ? `/${base64Encode(dir)}/chat?hint=${Date.now()}` : "/chat"
            }}
            buildDeleteFallback={(s: Session) => `/${base64Encode(s.directory)}/chat`}
            activeSessionId={() => params.id}
            sectionTitle="Octo Chat"
            sectionIcon={() => <img src="/IconChat1.svg" alt="" style={{ width: "20px", height: "20px" }} />}
            newButtonText="新建对话"
            trackerModule="chat"
            showSettings
            sidebarSourceKey="cowork"
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: "0",
            bottom: "0",
            left: `${sidebarWidth() - 4}px`,
            width: "8px",
            cursor: "col-resize",
            "z-index": "10",
          }}
          onMouseDown={handleSidebarResize}
        />
      </Show>
      <div class="flex-1 min-w-0 min-h-0">
        <Suspense fallback={<div class="p-3 text-14-regular text-text-weak">Loading session...</div>}>
          <SessionProviders>
            <SessionPage />
          </SessionProviders>
        </Suspense>
      </div>
    </div>
  )
}