import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { File } from "@opencode-ai/ui/file"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { ThemeProvider, useTheme } from "@opencode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router, useLocation, useNavigate, useParams } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"
import { LayoutProvider, useLayout } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layoutnet"
import { ErrorPage } from "./pages/error"
import { OctoSidebar } from "@/pages/_shell/sidebar"
// DEV-ONLY:insight 组件隔离预览路由(见 pages/insight/__dev/routes.tsx)。
import { insightDevRoutes } from "@/pages/insight/__dev/routes"
// 生产构建把 console 对象参数序列化成 JSON 再落盘(insight-debug.log 转发只拿到字符串,
// 否则全是 "[object Object]");dev 不装,保留 DevTools 对象可展开。见模块头注释。
import { installConsoleObjectSerializer } from "@/pages/insight/lib/console-serialize"
if (!import.meta.env.DEV) installConsoleObjectSerializer()
import { MakeSidebar } from "@/pages/make/sidebar"
import { PatternSidebar } from "@/pages/pattern/modules/sidebar/sidebar"
import { InsightSidebar } from "@/pages/insight/sidebar"
import { InsightQueueRunner } from "@/pages/insight/queue-runner"
import { ProjectInfo } from "@/components/project-info"
import { SidebarFooter } from "@/pages/insight/components/sidebar-footer"
import { MakeLayoutProvider, useMakeLayout } from "@/context/make-layout"
import { DialogProjectOnboarding } from "@/components/dialog-project-onboarding"
import { WelcomePage } from "@/components/welcome-page"
import { useCheckServerHealth } from "./utils/server-health"
import { persisted, Persist } from "@/utils/persist"
// jk-j60099994-replace-with-octo-1-start
// jk-j60099994-replace-with-octo-1-end

// jk-j60099994-replace-with-60062650-octo-1-start
// jk-j60099994-replace-with-60062650-octo-1-end

const ChatPage = lazy(() => import("@/pages/chat"))
const InsightPage = lazy(() => import("@/pages/insight"))
const MakePage = lazy(() => import("@/pages/make"))
const PatternPage = lazy(() => import("@/pages/pattern"))
const SkillsPage = lazy(() => import("@/pages/skills"))
const StudioPage = lazy(() => import("@/pages/studio/index"))
const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)
const Loading = () => <div class="size-full" />

// ⚠️ DEV-ONLY 守卫必须写在 JSX 之外,不要改回 `{import.meta.env.DEV && insightDevRoutes()}`。
// 原因:vite-plugin-solid 的 babel 转换排在 vite:define 之前(Vite 插件序里 definePlugin 在
// normalPlugins 之后),Solid 见到 JSX 里的成员表达式 import.meta.env.DEV 会判定"可能响应式",
// 额外套一层内嵌 memo,编译成 memo(() => memo(() => false)() && insightDevRoutes())——
// 内层是运行时调用,Rollup 折不掉,__dev/ 全部预览 chunk 照样进生产包(实测约 78KB)。
// 提到模块级三元后,esbuild 在 transform 阶段就折成 false,整棵 __dev/ 子树被摇掉(实测 0 字节)。
// 详见 docs/learning/solid-jsx-blocks-import-meta-env-treeshaking.md。
const insightDevRoutesOrNone = import.meta.env.DEV ? insightDevRoutes : () => null

if (typeof location === "object" && /\/session(?:\/|$)/.test(location.pathname)) {
  void loadSession()
}

const SessionRoute = () => (
  <SessionProviders>
    <Session />
  </SessionProviders>
)

const ChatIndexRoute = () => <Navigate href="chat" />
const SessionRedirectRoute = () => {
  const params = useParams<{ id?: string }>()
  return <Navigate href={`../chat/${params.id ?? ""}`} />
}
const CoworkRedirectRoute = () => {
  return <Navigate href="/insight" />
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
    }
  }
}

function ForceLightScheme(props: ParentProps) {
  const theme = useTheme()
  onMount(() => {
    if (theme.colorScheme() !== "light") theme.setColorScheme("light")
  })
  return props.children
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function OctoSidebarLayout(props: ParentProps) {
  const [sidebarWidthStore, setSidebarWidthStore] = persisted(
    Persist.global("cowork.sidebar.width"),
    createStore({ width: 296 }),
  )
  const sidebarWidth = () => sidebarWidthStore.width
  const setSidebarWidth = (w: number) => setSidebarWidthStore({ width: w })

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(200, Math.min(360, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div data-cowork-area="sidebar" class="flex flex-1 min-h-0 min-w-0 overflow-hidden relative" style={{ "--sidebar-width": `${sidebarWidth()}px` }}>
      <OctoSidebar />
      <div
        class="absolute top-0 bottom-0 flex items-center justify-center group"
        style={{
          left: `${sidebarWidth() - 10}px`,
          width: "20px",
          cursor: "col-resize",
          "z-index": "10",
        }}
        onMouseDown={handleSidebarResize}
      >
        <div
          class="absolute left-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
          style={{
            width: "12px",
            height: "36px",
            "border-radius": "0 10px 10px 0",
            "box-shadow": "2px 0 4px rgba(0,0,0,0.04), inset -1px 0 0 rgba(0,0,0,0.02)",
            border: "1px solid var(--octo-border-divider)",
            "border-left": "none",
            display: "none"
          }}
        >
          <div
            class="w-[2px] h-[14px] rounded-full ml-[2px]"
            style={{ background: "var(--octo-border-input, #c9c9c9)" }}
          />
        </div>
      </div>
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        {props.children}
      </div>
    </div>
  )
}

function PatternSidebarLayout(props: ParentProps) {
  const [sidebarWidthStore, setSidebarWidthStore] = persisted(
    Persist.global("pattern.sidebar.width"),
    createStore({ width: 296 }),
  )
  const sidebarWidth = () => sidebarWidthStore.width
  const setSidebarWidth = (w: number) => setSidebarWidthStore({ width: w })

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(200, Math.min(360, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div data-make-area="sidebar" class="flex flex-1 min-h-0 min-w-0 overflow-hidden relative">
      <PatternSidebar width={sidebarWidth()} />
      <div
        class="absolute top-0 bottom-0 flex items-center justify-center group"
        style={{
          left: `${sidebarWidth() - 10}px`,
          width: "20px",
          cursor: "col-resize",
          "z-index": "10",
        }}
        onMouseDown={handleSidebarResize}
      >
        <div
          class="absolute left-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
          style={{
            width: "12px",
            height: "36px",
            "border-radius": "0 10px 10px 0",
            "box-shadow": "2px 0 4px rgba(0,0,0,0.04), inset -1px 0 0 rgba(0,0,0,0.02)",
            border: "1px solid var(--octo-border-divider)",
            "border-left": "none",
            display: "none"
          }}
        >
          <div
            class="w-[2px] h-[14px] rounded-full ml-[2px]"
            style={{ background: "var(--octo-border-input, #c9c9c9)" }}
          />
        </div>
      </div>
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        {props.children}
      </div>
    </div>
  )
}

function MakeSidebarLayout(props: ParentProps) {
  return (
    <MakeLayoutProvider>
      <MakeSidebarArea>{props.children}</MakeSidebarArea>
    </MakeLayoutProvider>
  )
}

function MakeSidebarArea(props: ParentProps) {
  const ml = useMakeLayout()
  const layout = useLayout()
  const focusMode = layout.focusMode.get

  function handleResize(e: MouseEvent) {
    if (ml.leftCollapsed()) return
    e.preventDefault()
    const startX = e.clientX
    const startW = ml.leftW()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => ml.setLeftW(startW + ev.clientX - startX)
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <>
      <style>{`
        .make-sidebar { transition: transform 200ms ease; will-change: transform; }
        .make-sidebar.is-collapsed { position: fixed; top: 48px; bottom: 0; left: 0; height: auto; z-index: 32; transform: translateX(-100%); }
        body.make-left-drawer-open .make-sidebar.is-collapsed { transform: translateX(0); box-shadow: 11px 0 20px 0 rgba(0,0,0,0.08); }
        .make-sidebar-overlay { display: none; position: fixed; inset: 0; z-index: 30; }
        body.make-left-drawer-open .make-sidebar-overlay { display: block; }
        .make-sidebar-resize { position: absolute; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 10; }
        .make-right-panel { transition: transform 200ms ease; will-change: transform; }
        .make-right-panel.is-collapsed { position: fixed; top: 48px; bottom: 0; right: 0; height: auto; width: 650px; max-width: calc(100vw - 24px); z-index: 32; transform: translateX(100%); background: #fff; }
        body.make-right-drawer-open .make-right-panel.is-collapsed { transform: translateX(0); box-shadow: -11px 0 20px 0 rgba(0,0,0,0.08); }
        .make-right-overlay { display: none; position: fixed; inset: 0; z-index: 30; }
        body.make-right-drawer-open .make-right-overlay { display: block; }
        .make-icon-btn { color: #777; background: transparent; cursor: pointer; }
        .make-icon-btn [data-component="icon"] { color: #777; transition: color 100ms ease; }
        .make-icon-btn:hover { color: #0a59f7; }
        .make-icon-btn:hover [data-component="icon"] { color: #0a59f7; }
        .make-icon-btn[data-expanded], .make-icon-btn[data-state="open"] { color: #0a59f7; }
        .make-icon-btn[data-expanded] [data-component="icon"], .make-icon-btn[data-state="open"] [data-component="icon"] { color: #0a59f7; }
        .make-chat-folded .scroll-view__viewport { max-width: 824px; margin-left: auto; margin-right: auto; }
        .make-chat-folded .make-composer { max-width: 800px; margin-left: auto; margin-right: auto; }
      `}</style>
      <div
        data-make-area="sidebar"
        class="flex flex-1 min-h-0 min-w-0 overflow-hidden relative"
        style={{ "--sidebar-width": `${ml.leftW()}px` }}
      >
        <div class="make-sidebar-overlay" onClick={() => ml.toggleLeftDrawer()} />
        <div
          class="make-sidebar h-full shrink-0 flex flex-col overflow-hidden"
          classList={{ "is-collapsed": ml.leftCollapsed() || focusMode() }}
          style={{ "border-right": "1px solid var(--border-weak-base)", background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)" }}
        >
          <MakeSidebar />
        </div>
        <Show when={!ml.leftCollapsed() && !focusMode()}>
          <div class="make-sidebar-resize" style={{ left: `${ml.leftW() - 4}px` }} onMouseDown={handleResize} />
        </Show>
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden">{props.children}</div>
      </div>
    </>
  )
}

// insight 侧栏在 /skills 上的复用壳:与 /insight 用同一个自包含的 InsightSidebar
// (自管宽度/拖拽/持久化 octo:insight:sidebar-width),故此处只摆布局、不重复 resize 逻辑。
// 见 InsightPage 主体同款结构(pages/insight/index.tsx)。
// 注意:不加 data-cowork-area——那是旧 _shell/OctoSidebar 的属性,cowork.css 针对它有一坨
// 样式覆盖(如滚动区 padding 改 8px 16px),套到 InsightSidebar 上会让 /skills 与 /insight
// 的间距/选中样式不一致(InsightSidebar 自带样式,不吃 cowork.css)。
function InsightSidebarLayout(props: ParentProps) {
  return (
    <div class="flex flex-1 min-h-0 min-w-0 overflow-hidden relative">
      <InsightSidebar top={<ProjectInfo />} bottom={<SidebarFooter />} />
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        {props.children}
      </div>
    </div>
  )
}

function SkillsSidebarLayout(props: ParentProps) {
  const layout = useLayout()
  const source = layout.sidebarSource.get()
  return source === "make"
    ? <MakeSidebarLayout>{props.children}</MakeSidebarLayout>
     : source === "pattern"
    ? <PatternSidebarLayout>{props.children}</PatternSidebarLayout>
    : <InsightSidebarLayout>{props.children}</InsightSidebarLayout>
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function OnboardingLayer() {
  const navigate = useNavigate()
  const server = useServer()
  const layout = useLayout()

  const showOnboarding = createMemo(() => {
    if (!server.ready()) return false
    return layout.onboarding.show()
  })

  const [step, setStep] = createSignal<"project" | "welcome">("project")

  function handleProjectSelect() {
    setStep("welcome")
  }

  function handleWelcomeComplete() {
    layout.onboarding.hide()
  }

  return (
    <Show when={showOnboarding()}>
      <Show when={step() === "project"}>
        <DialogProjectOnboarding onSelect={handleProjectSelect} />
      </Show>
      <Show when={step() === "welcome"}>
        <WelcomePage onComplete={handleWelcomeComplete} />
      </Show>
    </Show>
  )
}

function FocusModeResetHandler() {
  const location = useLocation()
  const layout = useLayout()

  createEffect(() => {
    if (!location.pathname.startsWith("/make")) {
      layout.focusMode.set(false)
    }
  })

  return null
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <RouterInner appChildren={props.appChildren}>
            {props.children}
          </RouterInner>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function RouterInner(props: ParentProps<{ appChildren?: JSX.Element }>) {
  const location = useLocation()
  const layout = useLayout()
  const sidebarSource = () => layout.sidebarSource.get()

  const isInsightPage = () => {
    const p = location.pathname
    return p === "/" || p === "/cowork" || p === "/insight" || p.startsWith("/insight/")
  }

  const isMakePage = () => {
    const p = location.pathname
    return p === "/make" || p.startsWith("/make/")
  }

  const isPatternPage = () => {
    const p = location.pathname
    return p === "/pattern" || p.startsWith("/pattern/")
  }

  const isSkillsPage = () => {
    return location.pathname === "/skills"
  }

  // Whether skills is opened from make/pattern context (vs insight/cowork)
  const skillsFromMake = () => isSkillsPage() && sidebarSource() === "make"
  const skillsFromPattern = () => isSkillsPage() && sidebarSource() === "pattern"

  return (
    <>
      <FocusModeResetHandler />
      <NotificationProvider>
        <ModelsProvider>
          <CommandProvider>
            <HighlightsProvider>
              <Layout>
                <OnboardingLayer />
                {/* SPEC-INS-010 §11:/insight 由 InsightPage 自带侧栏,不再套 OctoSidebarLayout(否则双侧栏) */}
                <Show when={isInsightPage()}>
                  {props.children}
                </Show>
                {/* Make + skills from make: 共用 MakeSidebarLayout,侧栏不重挂 */}
                <Show when={isMakePage() || skillsFromMake()}>
                  <MakeSidebarLayout>
                    <Show when={isMakePage()} fallback={<SkillsPage />}>
                      {props.children}
                    </Show>
                  </MakeSidebarLayout>
                </Show>
                {/* Pattern + skills from pattern: 共用 PatternSidebarLayout */}
                <Show when={isPatternPage() || skillsFromPattern()}>
                  <PatternSidebarLayout>
                    <Show when={isPatternPage()} fallback={<SkillsPage />}>
                      {props.children}
                    </Show>
                  </PatternSidebarLayout>
                </Show>
                {/* Skills from insight/cowork: InsightSidebarLayout */}
                <Show when={isSkillsPage() && !skillsFromMake() && !skillsFromPattern()}>
                  <InsightSidebarLayout>
                    <SkillsPage />
                  </InsightSidebarLayout>
                </Show>
                <Show when={!isInsightPage() && !isMakePage() && !isPatternPage() && !isSkillsPage()}>
                  {props.appChildren}
                  {props.children}
                </Show>
              </Layout>
            </HighlightsProvider>
          </CommandProvider>
        </ModelsProvider>
      </NotificationProvider>
    </>
  )
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
        }}
      >
        <ForceLightScheme>
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <DialogProvider>
                  {/* jk-j60099994-replace-with-octo-2-start */}
                  {/* jk-j60099994-replace-with-octo-2-end */}
                  {/* jk-j60099994-replace-with-60062650-octo-2-start */}
                  {/* jk-j60099994-replace-with-60062650-octo-2-end */}
                  <MarkedProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </MarkedProvider>
                  {/* jk-j60099994-replace-with-60062650-octo-3-start */}
                  {/* jk-j60099994-replace-with-60062650-octo-3-end */}
                  {/* jk-j60099994-replace-with-octo-3-start */}
                  {/* jk-j60099994-replace-with-octo-3-end */}
                </DialogProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
        </ForceLightScheme>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  return (
    <Suspense
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      {/*<Show
        when={checkMode() === "blocking" ? !startupHealthCheck.loading : startupHealthCheck.state !== "pending"}
        fallback={
          <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
            <Splash class="w-16 h-20 opacity-50 animate-pulse" />
          </div>
        }
      >*/}
      {checkMode() === "blocking" ? startupHealthCheck() : startupHealthCheck.latest}
      <Show
        when={startupHealthCheck()}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
      {/*</Show>*/}
    </Suspense>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      disableHealthCheck={props.disableHealthCheck}
      servers={props.servers}
    >
      <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
        <ServerKey>
          <QueryProvider>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
                {/* jk-j60099994-replace-with-octo-4-start */}
                {/* jk-j60099994-replace-with-octo-4-end */}
                {/* SPEC-INS-027:insight 排队 drain 运行器。挂在 Router 之外,跨 tab/路由常驻,
                    使会话后台跑完时排队仍能继续 flush(不随 insight 页面卸载而死)。headless。 */}
                <InsightQueueRunner />
                <Dynamic
                  component={props.router ?? Router}
                  root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                >
                  <Route path="/" component={() => <Navigate href="/make" />} />
                  <Route path="/cowork" component={() => <Navigate href="/insight" />} />
                  {/* DEV-ONLY:静态段 /insight/__dev 优先于 :id?,且仅 dev 注册(守卫见上方 insightDevRoutesOrNone) */}
                  {insightDevRoutesOrNone()}
                  <Route path="/insight/:id?" component={InsightPage} />
                  <Route path="/make/:id?" component={MakePage} />
                  <Route path="/pattern/:id?" component={PatternPage} />
                  <Route path="/skills" component={SkillsPage} />
                  <Route path="/:dir" component={DirectoryLayout}>
                    <Route path="/" component={ChatIndexRoute} />
                    <Route path="/chat/:id?" component={ChatPage} />
                    <Route path="/cowork/:id?" component={CoworkRedirectRoute} />
                    <Route path="/studio/:id?" component={StudioPage} />
                    <Route path="/session/:id?" component={SessionRedirectRoute} />
                  </Route>
                </Dynamic>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </QueryProvider>
        </ServerKey>
      </ConnectionGate>
    </ServerProvider>
  )
}
