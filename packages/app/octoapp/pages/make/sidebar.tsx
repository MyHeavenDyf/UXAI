import { GroupedSidebar } from "@/components/grouped-sidebar"
import type { Session } from "@opencode-ai/sdk/v2/client"

export function MakeSidebar() {
  return (
    <GroupedSidebar
      namespace="make"
      routePrefix="/make"
      agentFilter="octo_make"
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
