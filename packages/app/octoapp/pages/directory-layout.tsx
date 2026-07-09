import { DataProvider } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, on, type ParentProps, Show } from "solid-js"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { useServer } from "@/context/server"
import { useProjectDir } from "@/hooks/use-project-dir"

const SESSIONS_DIR_NAME = "sessions"

function DirectoryDataProvider(props: ParentProps<{ directory: string; preserveProjectDir?: boolean }>) {
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const server = useServer()
  const slug = createMemo(() => base64Encode(props.directory))

  createEffect(() => {
    if (!props.preserveProjectDir && props.directory && !props.directory.endsWith(SESSIONS_DIR_NAME)) {
      server.projects.touch(props.directory)
    }
  })

  // 参照 Insight 的守卫模式：child store 在 Tab 切换期间持久化，
  // 如果消息已存在且最后一条 assistant 消息已完成（parts 已完整），
  // 则跳过 sync，避免用后端快照覆盖 SSE 实时数据。
  // 但如果最后一条 assistant 消息未完成（可能 parts 丢失），则强制 sync 补齐。
  createEffect(
    on(
      () => {
        const id = params.id ?? ""
        const messages = sync.data.message[id]
        if (!messages) return [id, true] as const
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
        const incomplete = !!lastAssistant && typeof lastAssistant.time.completed !== "number"
        return [id, incomplete] as const
      },
      ([id, needsSync]) => {
        if (!id || !needsSync) return
        void sync.session.sync(id)
      },
    ),
  )

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/chat/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/chat/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const location = useLocation()
  const mode = () => {
    const parts = location.pathname.split("/").filter(Boolean)
    return parts.length < 2 || parts[1] === "chat" ? ("chat" as const) : ("project" as const)
  }
  const projectDir = useProjectDir({ mode })
  const preserveProjectDir = createMemo(() => {
    const page = location.pathname.split("/").filter(Boolean)[1]
    return page === undefined || page === "chat" || page === "studio"
  })

  const resolved = createMemo(() => projectDir())

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolved} preserveProjectDir={preserveProjectDir()}>
              {props.children}
            </DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
