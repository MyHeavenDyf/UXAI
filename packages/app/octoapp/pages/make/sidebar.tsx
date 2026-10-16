import { useGlobalSDK } from "@/context/global-sdk"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { GroupedSidebar } from "@/components/grouped-sidebar"
import { DialogShareSession } from "@/components/dialog-share-session"
import { sessionTitle } from "@/utils/session-title"
import type { Session } from "@opencode-ai/sdk/v2/client"

const PAGE_SIZE = 30

export function MakeSidebar() {
  const globalSDK = useGlobalSDK()
  const projectDir = useProjectDir()
  const dialog = useDialog()

  const onShare = (session: Session) => {
    const dir = projectDir()
    dialog.show(() => (
      <DialogShareSession
        sessionID={session.id}
        sessionName={sessionTitle(session.title) ?? "新会话"}
        client={globalSDK.createClient({ directory: dir })}
        directory={dir}
      />
    ))
  }

  const fetchSessionPage = async (dir: string, cursor?: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      limit: PAGE_SIZE,
      cursor,
      agent: "octo_make",
    })
    const sessions = (result.data ?? []) as Session[]
    const next = result.response.headers.get("x-next-cursor")
    return { sessions, nextCursor: next ?? undefined }
  }

  const fetchPinnedSessions = async (dir: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      pinned: true,
      agent: "octo_make",
    })
    return (result.data ?? []) as Session[]
  }

  const fetchGroupSessions = async (dir: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      grouped: "true",
      agent: "octo_make",
      limit: 9999,
    })
    return (result.data ?? []) as Session[]
  }

  const fetchSessionById = async (dir: string, sessionID: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.session.get({ sessionID, directory: dir })
    return (result.data as Session | undefined) ?? null
  }

  return (
    <GroupedSidebar
      namespace="make"
      routePrefix="/make"
      agentFilter="octo_make"
      fetchSessionPage={fetchSessionPage}
      fetchPinnedSessions={fetchPinnedSessions}
      fetchGroupSessions={fetchGroupSessions}
      fetchSessionById={fetchSessionById}
      buildSessionRoute={(s: Session) => `/make/${s.id}`}
      buildNewRoute={() => "/make"}
      buildDeleteFallback={() => "/make"}
      sectionTitle="最近"
      newButtonText="新建对话"
      trackerModule="design"
      sidebarSourceKey="make"
      onShare={onShare}
      inlineBeforeSection
    />
  )
}
