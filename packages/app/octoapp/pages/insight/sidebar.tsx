import { createEffect, createSignal, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { GroupedSidebar } from "@/components/grouped-sidebar"
import { disableIframesDuringDrag } from "@/utils/iframe-drag"
import type { Session } from "@opencode-ai/sdk/v2/client"

export const SIDEBAR_WIDTH_KEY = "octo:insight:sidebar-width"
export const SIDEBAR_MIN_W = 200
export const SIDEBAR_MAX_W = 360
export const SIDEBAR_DEFAULT_W = 296

export function initialSidebarWidth(): number {
  const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  if (stored) {
    const n = parseInt(stored, 10)
    if (!isNaN(n)) return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, n))
  }
  return SIDEBAR_DEFAULT_W
}

export function InsightSidebar(props: { top?: JSX.Element; bottom?: JSX.Element; onWidthChange?: (w: number) => void }): JSX.Element {
  const [width, setWidth] = createSignal(initialSidebarWidth())
  const globalSDK = useGlobalSDK()

  createEffect(() => props.onWidthChange?.(width()))

  function handleResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const restoreIframes = disableIframesDuringDrag()
    const onMove = (ev: MouseEvent) => setWidth(Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      restoreIframes()
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const fetchInsightSessions = async (dir: string): Promise<Session[]> => {
    const insightApi = globalSDK.client.insight
    if (insightApi) {
      const result = await insightApi.sessions.list({ directory: dir, limit: 200 })
      return (result.data?.items ?? []) as Session[]
    }
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.session.list()
    return ((result.data ?? []) as Session[]) as Session[]
  }

  return (
    <div
      class="shrink-0 relative flex flex-col h-full"
      style={{ "--sidebar-width": `${width()}px` }}
    >
      <GroupedSidebar
        namespace="insight"
        routePrefix="/insight"
        agentFilter="octo_insight"
        fetchSessions={fetchInsightSessions}
        buildSessionRoute={(s: Session) => `/insight/${s.id}`}
        buildNewRoute={() => "/insight"}
        buildDeleteFallback={() => "/insight"}
        sectionTitle="最近"
        newButtonText="新建对话"
        trackerModule="insight"
        sidebarSourceKey="insight"
        inlineBeforeSection
      />
      <div
        class="absolute top-0 bottom-0"
        style={{ right: "-3px", width: "6px", cursor: "col-resize", "z-index": "10" }}
        onMouseDown={handleResize}
      />
    </div>
  )
}
