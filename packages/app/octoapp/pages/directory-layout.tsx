import { DataProvider } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, type ParentProps, Show } from "solid-js"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { useServer } from "@/context/server"
import { useProjectDir } from "@/hooks/use-project-dir"

const SESSIONS_DIR_NAME = "sessions"

function DirectoryDataProvider(props: ParentProps<{ directory: string; chatMode?: boolean }>) {
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const server = useServer()
  const slug = createMemo(() => base64Encode(props.directory))

  createEffect(() => {
    if (!props.chatMode && props.directory && !props.directory.endsWith(SESSIONS_DIR_NAME)) {
      server.projects.touch(props.directory)
    }
  })

  createResource(
    () => params.id,
    (id) => sync.session.sync(id),
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
  const isChatRoute = createMemo(() => mode() === "chat")

  const resolved = createMemo(() => projectDir())

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolved} chatMode={isChatRoute()}>
              {props.children}
            </DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
