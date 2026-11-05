import type { Session } from "@opencode-ai/sdk/v2/client"
import { Show, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { GroupedSidebar } from "@/components/grouped-sidebar"
import { tracker } from "@/utils/tracker"
import { decode64 } from "@/utils/base64"
import { sessionThumbnailUsesVideoElement, type ThumbnailMap } from "./session-thumbnail"
import { resolveStudioThumbnailUrl } from "./studio-media"

const PAGE_SIZE = 30

export type StudioSidebarProps = {
  directory: string
  routeSlug: string
  historyActive?: boolean
  onOpenHistory?: () => void
  onNewConversation: () => void
  toggleDrawer?: () => void
  thumbnails?: ThumbnailMap
  thumbnailsLoading?: boolean
  onLoadThumbnails?: (sessions: Session[]) => void
}

/**
 * Studio 左侧会话栏：复用 design 页的共享侧栏栈（GroupedSidebar → AgentSidebar →
 * SessionList），获得与 design 一致的置顶 / 分组 / 右键菜单 / 拖拽排序逻辑与样式，
 * 并通过 renderLeading 在每行左侧保留 studio 特有的 24×24 会话缩略图。
 */
export function StudioSidebar(props: StudioSidebarProps): JSX.Element {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()

  const fetchSessionPage = async (dir: string, cursor?: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      limit: PAGE_SIZE,
      cursor,
      agent: "octo_studio",
      roots: true,
      // 按侧栏「最近」显示顺序分页(sort_order 优先、time 次之)，否则后续页
      // 会含 sort_order 更小的会话，追加后被 recentSessions 重排到已显示条目
      // 之上，把列表第一条顶下去。
      order: "sort_order",
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
      agent: "octo_studio",
      roots: true,
    })
    return (result.data ?? []) as Session[]
  }

  const fetchGroupSessions = async (dir: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.experimental.session.list({
      directory: dir,
      grouped: "true",
      agent: "octo_studio",
      roots: true,
      limit: 9999,
    })
    return (result.data ?? []) as Session[]
  }

  const fetchSessionById = async (dir: string, sessionID: string) => {
    const client = globalSDK.createClient({ directory: dir })
    const result = await client.session.get({ sessionID, directory: dir })
    return (result.data as Session | undefined) ?? null
  }

  const renderLeading = (session: Session): JSX.Element => {
    const entry = () => props.thumbnails?.[session.id]
    const thumbnailUrl = () =>
      resolveStudioThumbnailUrl({
        value: entry()?.url,
        sdkUrl: globalSDK.url,
        directory: props.directory,
      })
    return (
      <div
        style={{
          width: "24px",
          height: "24px",
          "flex-shrink": "0",
          "border-radius": "4px",
          overflow: "hidden",
          background: "rgba(0,0,0,0.06)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <Show
          when={thumbnailUrl()}
          fallback={
            <Show
              when={props.thumbnailsLoading}
              fallback={
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              }
            >
              <Spinner class="size-3" />
            </Show>
          }
        >
          <Show
            when={sessionThumbnailUsesVideoElement(entry())}
            fallback={
              <img
                src={thumbnailUrl()!}
                alt=""
                style={{ width: "100%", height: "100%", "object-fit": "cover" }}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement
                  el.style.display = "none"
                }}
              />
            }
          >
            <video
              src={thumbnailUrl()!}
              muted
              playsinline
              preload="metadata"
              style={{ width: "100%", height: "100%", "object-fit": "cover" }}
            />
          </Show>
        </Show>
      </div>
    )
  }

  return (
    <GroupedSidebar
      namespace="studio"
      directory={props.directory}
      routePrefix={`/${props.routeSlug}/studio`}
      agentFilter="octo_studio"
      fetchSessionPage={fetchSessionPage}
      fetchPinnedSessions={fetchPinnedSessions}
      fetchGroupSessions={fetchGroupSessions}
      fetchSessionById={fetchSessionById}
      buildSessionRoute={(s: Session) => `/${props.routeSlug}/studio/${s.id}`}
      // 带 ?hint 跳过页面的 last-session 恢复 effect：分组右键「新建对话」经
      // GroupedSidebar.handleNewSessionInGroup 直接 navigate(buildNewRoute())，
      // 不带 hint 会被恢复到上一个会话，pendingGroup 滞留并误归组后续新会话。
      // 顶部「新建对话」按钮走 onNewSession 返回 false，不会用到该路由。
      buildNewRoute={() => `/${props.routeSlug}/studio?hint=${Date.now()}`}
      buildDeleteFallback={() => {
        const decoded = decode64(props.routeSlug)
        if (decoded) layout.lastSessionPerTab.setStudio(decoded, "")
        return `/${props.routeSlug}/studio`
      }}
      sectionTitle="最近"
      trackerModule="studio"
      inlineBeforeSection
      renderLeading={renderLeading}
      newButtonSuffix={() => (
        <Show when={typeof props.toggleDrawer === "function"}>
          <button
            type="button"
            class="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(25,25,25,0.06)] shrink-0"
            style={{ width: "36px", height: "36px" }}
            onClick={(e) => {
              e.stopPropagation()
              tracker.interaction({ module: "studio", name: "history-drawer-toggle" })
              props.toggleDrawer!()
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="15" viewBox="0 0 12 15" fill="none" class="shrink-0">
              <rect x="0.5" y="0.5" width="11" height="14" rx="2" stroke="#000000" />
              <line x1="2.67" y1="0.5" x2="2.67" y2="14.5" stroke="#000000" />
            </svg>
          </button>
        </Show>
      )}
      headerExtra={() => (
        <button
          type="button"
          class="relative flex items-center gap-3 w-full rounded-lg text-left transition-colors"
          classList={{
            "bg-[rgba(10,89,247,0.08)]": props.historyActive,
            "hover:bg-surface-base-hover": !props.historyActive,
          }}
          style={{
            height: "36px",
            padding: "0 12px",
            color: props.historyActive ? "#0A59F7" : "#191919",
            "font-size": "12px",
            "line-height": "20px",
          }}
          onClick={() => {
            tracker.interaction({ module: "studio", name: "history-open" })
            if (props.onOpenHistory) props.onOpenHistory()
            else navigate(`/${props.routeSlug}/studio?history=1`)
          }}
        >
          <img src={props.historyActive ? "/studio/studio_panels_active.png" : "/studio/studio_panels.png"} alt="" style={{ width: "20px", height: "20px", "flex-shrink": "0" }} />
          <span>{language.t("sidebar.history.title")}</span>
          <Show when={props.historyActive}>
            <span
              class="absolute rounded-full pointer-events-none"
              style={{
                right: "4px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "4px",
                height: "28px",
                background: "#0A59F7",
              }}
            />
          </Show>
        </button>
      )}
      onNewSession={() => {
        props.onNewConversation()
        return false
      }}
      onSessionsChange={(sessions) => props.onLoadThumbnails?.(sessions)}
    />
  )
}
