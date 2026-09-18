import { useGlobalSDK } from "@/context/global-sdk"
import { GroupedSidebar } from "@/components/grouped-sidebar"
import type { Session } from "@opencode-ai/sdk/v2/client"

const PAGE_SIZE = 30

export function MakeSidebar() {
  const globalSDK = useGlobalSDK()

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
      fetchSessionById={fetchSessionById}
      buildSessionRoute={(s: Session) => `/make/${s.id}`}
      buildNewRoute={() => "/make"}
      buildDeleteFallback={() => "/make"}
      sectionTitle="最近"
      newButtonText="新建对话"
      trackerModule="design"
      sidebarSourceKey="make"
      inlineBeforeSection
    />
  )
}
