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
import { GlobalSDKProvider, useGlobalSDK } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
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
import { DialogProjectOnboarding } from "@/components/dialog-project-onboarding"
import { useCheckServerHealth } from "./utils/server-health"
import { persisted, Persist } from "@/utils/persist"
// jk-j60099994-replace-with-octo-1-start
// jk-j60099994-replace-with-octo-1-end

const ChatPage = lazy(() => import("@/pages/chat"))
const CoworkPage = lazy(() => import("@/pages/cowork"))
const InsightPage = lazy(() => import("@/pages/insight"))
const MakePage = lazy(() => import("@/pages/make"))
const SkillsPage = lazy(() => import("@/pages/skills"))
const StudioPage = lazy(() => import("@/pages/studio/index"))
const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)
const Loading = () => <div class="size-full" />

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
  return <Navigate href="/cowork" />
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
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(360, startW + ev.clientX - startX)))
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
    <div data-cowork-area="sidebar" class="flex flex-1 min-h-0 min-w-0 overflow-hidden relative">
      <OctoSidebar width={sidebarWidth()} />
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
  const location = useLocation()
  const navigate = useNavigate()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()

  const showOnboarding = createMemo(() => location.pathname === "/")

  function handleOnboardingSelect(data: { directory: string }) {
    layout.projects.open(data.directory)
    server.projects.touch(data.directory)
    void globalSDK.createClient({ directory: data.directory }).session.list().catch(() => {})
    navigate("/cowork")
  }

  return (
    <Show when={showOnboarding()}>
      <DialogProjectOnboarding onSelect={handleOnboardingSelect} />
    </Show>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  const location = useLocation()

  const isOctoPage = () => {
    const p = location.pathname
    return p === "/" || p === "/cowork" || p === "/insight" || p.startsWith("/insight/") || p === "/make" || p.startsWith("/make/") || p === "/skills"
  }

  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>
                    <OnboardingLayer />
                    <Show when={isOctoPage()}>
                      <OctoSidebarLayout>{props.children}</OctoSidebarLayout>
                    </Show>
                    <Show when={!isOctoPage()}>
                      {props.appChildren}
                      {props.children}
                    </Show>
                  </Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
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
                  <MarkedProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </MarkedProvider>
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
                <Dynamic
                  component={props.router ?? Router}
                  root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                >
                  <Route path="/" component={CoworkPage} />
                  <Route path="/cowork" component={CoworkPage} />
                  <Route path="/insight/:id?" component={InsightPage} />
                  <Route path="/make/:id?" component={MakePage} />
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
