import { createMemo, createEffect, Show, ErrorBoundary, createSignal, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { Sidebar } from "@/components/sidebar"
import { useLocal } from "@/context/local"
import { decode64 } from "@/utils/base64"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import SessionPage from "@/pages/session"

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

  const resolvedDirectory = createMemo(() => {
    if (params.dir) {
      const decoded = decode64(params.dir)
      if (decoded) return decoded
    }
    return null
  })

  createEffect(() => {
    local.agent.set("octo_ai")
  })

  const [sidebarWidth, setSidebarWidth] = createSignal(296)

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(200, Math.min(480, startW + ev.clientX - startX)))
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
          style={{ width: `${sidebarWidth()}px` }}
        >
          <ErrorBoundary fallback={(err) => {
            console.error("Sidebar error:", err)
            return <div class="p-3 text-14-regular text-text-weak">Sidebar loading...</div>
          }}>
            <Sidebar currentDir={resolvedDirectory} activeTab={() => "chat"} />
          </ErrorBoundary>
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
        <SessionProviders>
          <SessionPage />
        </SessionProviders>
      </div>
    </div>
  )
}
