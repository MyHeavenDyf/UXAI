import { createMemo, createEffect, Show, ErrorBoundary, Suspense } from "solid-js"
import { useParams } from "@solidjs/router"
import { Sidebar } from "@/components/sidebar"
import { useLocal } from "@/context/local"
import { decode64 } from "@/utils/base64"
import { lazy } from "solid-js"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"

const SessionPage = lazy(() => import("@/pages/session"))

function SessionProviders(props: { children: any }) {
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

  return (
    <div class="flex flex-1 min-w-0 min-h-0 h-full">
      <Show when={resolvedDirectory()}>
        <div class="sidebar-wrap h-full shrink-0 border-r border-border-weak-base flex flex-col">
          <ErrorBoundary fallback={(err) => {
            console.error("Sidebar error:", err)
            return <div class="p-3 text-14-regular text-text-weak">Sidebar loading...</div>
          }}>
            <Sidebar currentDir={resolvedDirectory} activeTab={() => "chat"} />
          </ErrorBoundary>
        </div>
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