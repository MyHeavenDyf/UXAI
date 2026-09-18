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

  const PAGE_SIZE = 30

  const fetchSessionPage = async (dir: string, cursor?: string) => {
    const insightApi = globalSDK.client.insight
    if (insightApi) {
      const offset = Number(cursor ?? 0)
      const result = await insightApi.sessions.list({ directory: dir, limit: PAGE_SIZE, offset: String(offset) })
      const items = (result.data?.items ?? []) as Session[]
      const total = Number(result.data?.total ?? 0)
      const nextOffset = offset + items.length
      return { sessions: items, nextCursor: nextOffset < total ? String(nextOffset) : undefined }
    }
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({ directory: dir, limit: PAGE_SIZE, cursor })
    const items = ((result.data ?? []) as Session[]) as Session[]
    const next = result.response.headers.get("x-next-cursor")
    return { sessions: items, nextCursor: next ?? undefined }
  }

  const fetchPinnedSessions = async (dir: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      pinned: true,
      agent: "octo_insight",
    })
    return (result.data ?? []) as Session[]
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
        fetchSessionPage={fetchSessionPage}
        fetchPinnedSessions={fetchPinnedSessions}
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
