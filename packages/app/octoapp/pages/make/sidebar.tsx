import { useGlobalSDK } from "@/context/global-sdk"
import { GroupedSidebar } from "@/components/grouped-sidebar"
import type { Session } from "@opencode-ai/sdk/v2/client"

const PAGE_SIZE = 30

export function MakeSidebar() {
  const globalSDK = useGlobalSDK()

  const fetchSessionPage = async (dir: string, cursor?: number) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      limit: PAGE_SIZE,
      cursor,
      agent: "octo_make",
    })
    const sessions = (result.data ?? []) as Session[]
    const next = result.response.headers.get("x-next-cursor")
    return { sessions, nextCursor: next ? Number(next) : undefined }
  }

  return (
    <GroupedSidebar
      namespace="make"
      routePrefix="/make"
      agentFilter="octo_make"
      fetchSessionPage={fetchSessionPage}
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
