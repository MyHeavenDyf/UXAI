import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { INSIGHT_AGENT } from "@/constants/agent"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { tracker } from "@/utils/tracker"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { useLayout } from "@/context/layout"
import { SidebarShell } from "@/components/sidebar-shell"
import { SessionList } from "@/components/session-list"

export function OctoSidebar() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const notification = useNotification()
  const permission = usePermission()
  const layout = useLayout()

  const projectDir = useProjectDir()

  // Resolved directory signal — the single source of truth for session loading.
  // Populated by two effects from different reliable reactive sources.
  const [resolvedDir, setResolvedDir] = createSignal<string>()

  const isOnboarding = createMemo(() => !resolvedDir())

  // Track which directory the fetched data came from, so we only show content
  // when the data matches the current directory (prevents flicker when dir changes from home → project)
  const [insightFetchedDir, setInsightFetchedDir] = createSignal<string>()

  // Effect 1: read projectDir() which tracks server.projects.last (memo, reactive).
  // For returning users this fires immediately on mount with the persisted directory.
  createEffect(() => {
    const d = projectDir()
    if (d) setResolvedDir(d)
  })

  // Effect 2: track globalSync.data.ready (= bootstrap.isPending from useQuery, reliable).
  // When bootstrap completes, explicitly read projectDir() — by then pathQuery.data is cached
  // and the getter returns the real path even though the reactivity chain is broken.
  createEffect(() => {
    if (!globalSync.data.ready) {
      const d = projectDir()
      if (d) setResolvedDir(d)
    }
  })

  // 服务端分页(SPEC-INS-013):走 insight 专用端点 /insight/sessions(服务端先按 agent 过滤再分页),
  // 与 components/session-list/index.tsx 同源同策略。limit 跟随目录,点「加载更多」抬高重拉。
  const FIRST_PAGE = 100
  const PAGE_STEP = 100
  const [limit, setLimit] = createSignal(FIRST_PAGE)
  createEffect(on(resolvedDir, () => setLimit(FIRST_PAGE), { defer: true }))

  // Insight sessions
  const [sessions, { refetch }] = createResource(
    () => ({ dir: isOnboarding() ? "" : (resolvedDir() ?? ""), limit: limit() }),
    async ({ dir, limit: lim }): Promise<{ items: Session[]; total: number }> => {
      if (!dir) {
        setInsightFetchedDir(dir)
        return { items: [], total: 0 }
      }
      const client = globalSDK.createClient({ directory: dir })
      try {
        // 防御性:.insight 在 SDK 陈旧/旧版时可能为 undefined;data 为空表示端点 404 未部署。两者都回退。
        const insightApi = client.insight
        if (insightApi) {
          const result = await insightApi.sessions.list({ directory: dir, limit: lim })
          if (result.data) {
            const items = (result.data.items ?? []) as Session[]
            const rawTotal = result.data.total
            const total = typeof rawTotal === "number" ? rawTotal : items.length
            setInsightFetchedDir(dir)
            return { items, total }
          }
        }
        // 过渡回退:后端端点未部署 / 旧 SDK → 通用 session.list + 前端过滤(旧「先 limit 再筛」路径,仅兼容用)。
        console.warn("[shell:sidebar] /insight/sessions unavailable, falling back to session.list")
        const legacy = await client.session.list()
        const filtered = ((legacy.data ?? []) as Array<Session & { agent?: string }>)
          .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
          .filter(s => s.agent === INSIGHT_AGENT)
        setInsightFetchedDir(dir)
        return { items: filtered, total: filtered.length }
      } catch (err) {
        console.error("[shell:sidebar] insight list failed", err)
        setInsightFetchedDir(dir)
        return { items: [], total: 0 }
      }
    },
  )

  // total 镜像进信号:render 里绝不能直接读 resource accessor sessions()。
  // 否则每次 session.updated 触发的 refetch 会把该 resource 推回 pending,而它被全局
  // <Suspense>(octo.tsx 的 Splash)追踪 → 整页闪「初始加载动画」(本组件无就近 Suspense 边界)。
  // 见 octo-agent docs/learning/resource-accessor-refetch-flashes-global-suspense.md。
  const [sessionList, setSessionList] = createStore<Session[]>([])
  const [sessionTotal, setSessionTotal] = createSignal(0)
  createEffect(on(sessions, (data) => {
    if (data) {
      setSessionList(reconcile(data.items, { key: "id" }))
      setSessionTotal(data.total)
    }
  }, { defer: true }))

  // 读镜像信号 sessionTotal(),不读 sessions()——避免上面说的全局 Suspense 闪屏。
  const hasMore = () => sessionList.length < sessionTotal()
  function loadMore() {
    const next = limit() + PAGE_STEP
    setLimit(next)
    tracker.interaction({ module: "insight", name: "session-load-more", extend: JSON.stringify({ limit: next, source: "shell" }) })
  }

  const insightStable = createMemo(() => insightFetchedDir() === resolvedDir())

  let refetchTimer: ReturnType<typeof setTimeout> | undefined

  const unsub = globalSDK.event.listen((e) => {
    const t = e.details.type
    if (t === "session.created" || t === "session.updated" || t === "session.deleted") {
      clearTimeout(refetchTimer)
      refetchTimer = setTimeout(() => void refetch(), 1000)
    }
  })
  onCleanup(unsub)
  onCleanup(() => { clearTimeout(refetchTimer) })

  const activeSessionId = () => {
    const m = location.pathname.match(/^\/insight\/(.+)$/)
    return m?.[1]
  }

  const [insightCollapsed, setInsightCollapsed] = createSignal(false)
  const [activeNav, setActiveNav] = createSignal<string | null>(null)

  // Scroll to active session when switching
  const sessionRefs = new Map<string, HTMLElement>()
  createEffect(() => {
    const id = activeSessionId()
    if (!id) return
    void sessionList.length
    requestAnimationFrame(() => {
      const el = sessionRefs.get(id)
      if (el) el.scrollIntoView({ block: "nearest" })
    })
  })

  function newSession() {
    const dir = resolvedDir()
    if (!dir) return
    const client = globalSDK.createClient({ directory: dir })
    void client.session.create({ directory: dir, agent: INSIGHT_AGENT }).then((result) => {
      const session = result.data as Session | undefined
      if (session) navigate(`/insight/${session.id}`)
    })
  }

  return (
    <SidebarShell
      newButtonText="新建"
      onNewClick={newSession}
      sectionTitle="Octo Insight"
      sectionIcon={() => <img src="/insightIcon.svg" alt="" style={{ width: "20px", height: "20px" }} />}
      collapsed={insightCollapsed()}
      onToggleCollapse={() => setInsightCollapsed(v => !v)}
      activeNav={location.pathname === "/skills" ? "skill_market" : activeNav()}
      onNavClick={(key) => {
        if (key === "skill_market") {
          layout.sidebarSource.set("cowork")
          navigate("/skills")
        } else {
          setActiveNav(v => v === key ? null : key)
        }
      }}
    >
      <SessionList
        sessions={sessionList}
        activeSessionId={activeSessionId()}
        stable={insightStable()}
        isOnboarding={isOnboarding()}
        hasMore={hasMore()}
        loadingMore={sessions.loading}
        onLoadMore={loadMore}
        onSessionClick={(s) => navigate(`/insight/${s.id}`)}
        itemRef={(s, el) => { if (el) sessionRefs.set(s.id, el) }}
      />
    </SidebarShell>
  )
}
