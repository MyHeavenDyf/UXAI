import { createEffect, createSignal } from "solid-js"
import { useLocation } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { AgentSidebar } from "@/components/agent-sidebar"
import type { Session } from "@opencode-ai/sdk/v2/client"

export function MakeSidebar() {
  const location = useLocation()
  const globalSync = useGlobalSync()
  const projectDir = useProjectDir()

  const [resolvedDir, setResolvedDir] = createSignal<string>()

  createEffect(() => {
    const d = projectDir()
    if (d) setResolvedDir(d)
  })

  createEffect(() => {
    if (!globalSync.data.ready) {
      const d = projectDir()
      if (d) setResolvedDir(d)
    }
  })

  return (
    <AgentSidebar
      directory={resolvedDir()}
      agentFilter="octo_make"
      buildSessionRoute={(s: Session) => `/make/${s.id}`}
      buildNewRoute={() => "/make"}
      buildDeleteFallback={() => "/make"}
      activeSessionId={() => {
        const m = location.pathname.match(/^\/make\/(.+)$/)
        return m?.[1]
      }}
      sectionTitle="Octo Design"
      sectionIcon={() => (
        <span style={{ "--icon-base": "#0a59f7", display: "inline-flex" }}>
          <Icon name="tab-make" size="normal" />
        </span>
      )}
      newButtonText="新建对话"
      trackerModule="design"
      sidebarSourceKey="make"
    />
  )
}
