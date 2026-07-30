import "./make/octo-tokens.css"
import { createMemo, createEffect, createSignal, on, Show, Suspense, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { tracker } from "@/utils/tracker"
import { AgentSidebar } from "@/components/agent-sidebar"
import { useResponsiveBreakpoints } from "@/components/responsive-layout"
import { useLocal } from "@/context/local"
import { useTabModel } from "@/hooks/use-tab-model"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { decode64 } from "@/utils/base64"
import { persisted, Persist } from "@/utils/persist"
import { lazy } from "solid-js"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { SkillsContent } from "@/components/skills-content"

const SessionPage = lazy(() => import("@/pages/session"))

function SessionProviders(props: { children: JSX.Element }) {
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

export default function ChatPage() {
  const params = useParams<{ dir?: string; id?: string }>()
  const local = useLocal()
  useTabModel("chat")
  const layout = useLayout()
  const sdk = useSDK()
  const { isNarrow } = useResponsiveBreakpoints()

  const resolvedDirectory = createMemo(() => sdk.directory || null)

  onMount(() => {
    tracker.page({ module: "chat", name: "chat-page" })
    local.agent.set("octo_ai")
  })

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      ({ dir, id }) => {
        if (dir && id) {
          const decoded = decode64(dir)
          if (decoded) layout.lastSessionPerTab.setChat(decoded, id)
        }
      },
    ),
  )

  const [sidebarWidthStore, setSidebarWidthStore] = persisted(
    Persist.global("chat.sidebar.width"),
    createStore({ width: 300 }),
  )
  const sidebarWidth = () => sidebarWidthStore.width
  const setSidebarWidth = (w: number) => setSidebarWidthStore({ width: w })

  // Reactive drawer state
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [drawerClosing, setDrawerClosing] = createSignal(false)
  let sidebarEl: HTMLDivElement | undefined

  // Skills panel state — 与会话选中互斥
  const [skillsPanelOpen, setSkillsPanelOpen] = createSignal(false)
  const navigate = useNavigate()

  function toggleSkillsPanel() {
    if (skillsPanelOpen()) {
      setSkillsPanelOpen(false)
    } else {
      setSkillsPanelOpen(true)
      const dir = resolvedDirectory()
      if (dir && params.id) navigate(`/${base64Encode(dir)}/chat`)
    }
  }

  // 选中会话时关闭技能库
  createEffect(on(() => params.id, (id) => {
    if (id) setSkillsPanelOpen(false)
  }, { defer: true }))

  const displayWidth = () => {
    if (drawerOpen()) return 296
    if (drawerClosing()) return 296
    return sidebarWidth()
  }

  function openDrawer() {
    setDrawerOpen(true)
    document.body.classList.add("chat-drawer-open")
  }

  function closeDrawer() {
    if (!drawerOpen()) return
    setDrawerOpen(false)
    setDrawerClosing(true)
    document.body.classList.remove("chat-drawer-open")
  }

  function toggleDrawer() {
    if (drawerOpen()) closeDrawer()
    else openDrawer()
  }

  // Sync drawer signal with body class (for external toggles like notepad button)
  onMount(() => {
    const observer = new MutationObserver(() => {
      const open = document.body.classList.contains("chat-drawer-open")
      if (open !== drawerOpen()) {
        setDrawerOpen(open)
        if (!open) setDrawerClosing(true)
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })

    sidebarEl?.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform") setDrawerClosing(false)
    })
    document.addEventListener("click", (e) => {
      if (!drawerOpen()) return
      const target = e.target as HTMLElement
      if (target.closest(".chat-sidebar") || target.closest("[data-drawer-toggle]")) return
      closeDrawer()
    })
    // Close drawer when viewport widens beyond 656px
    const mq = window.matchMedia("(max-width: 656px)")
    mq.addEventListener("change", (e) => {
      if (!e.matches) closeDrawer()
    })
  })

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
    <div class="relative flex flex-1 min-w-0 min-h-0 h-full">
      {resolvedDirectory() && (
        <>
          <style>{`
            .chat-sidebar-overlay {
              display: none;
              position: fixed;
              inset: 0;
              z-index: 30;
            }
            .chat-sidebar-resize {
              position: absolute;
              top: 0;
              bottom: 0;
              width: 8px;
              cursor: col-resize;
              z-index: 10;
            }
            @media (max-width: 656px) {
              .chat-sidebar {
                position: fixed !important;
                top: 48px; bottom: 0; left: 0;
                height: auto !important;
                z-index: 32;
                transform: translateX(-100%);
                transition: transform 200ms ease;
                border-right: none !important;
              }
              body.chat-drawer-open .chat-sidebar {
                transform: translateX(0);
                box-shadow: 11px 0 20px 0 rgba(0,0,0,0.08);
              }
              body.chat-drawer-open .chat-sidebar-overlay { display: block; }
              .chat-sidebar-resize { display: none !important; }
            }
          `}</style>
          <div class="chat-sidebar-overlay" onClick={() => document.body.classList.remove("chat-drawer-open")} />
          <div
            ref={sidebarEl}
            class="chat-sidebar h-full shrink-0 border-r border-border-weak-base flex flex-col"
            style={{ width: `${displayWidth()}px`, "--sidebar-width": `${displayWidth()}px` }}
          >
            <AgentSidebar
              directory={resolvedDirectory()}
              agentFilter="octo_ai"
              showProjectInfo={false}
              showBottomNav
              listParams={{ scope: "project", category: "dev" }}
              buildSessionRoute={(s: Session) => `/${base64Encode(s.directory)}/chat/${s.id}`}
              buildNewRoute={() => {
                const dir = resolvedDirectory()
                return dir ? `/${base64Encode(dir)}/chat?hint=${Date.now()}` : "/chat"
              }}
              buildDeleteFallback={(s: Session) => `/${base64Encode(s.directory)}/chat`}
              activeSessionId={() => params.id}
              sectionTitle="Octo Chat"
              sectionIcon={() => <img src="/IconChat1.svg" alt="" style={{ width: "20px", height: "20px" }} />}
              newButtonText="新建对话"
              trackerModule="chat"
              showSettings
              sidebarSourceKey="cowork"
              onSkillClick={toggleSkillsPanel}
              skillsActive={skillsPanelOpen()}
            />
          </div>
          <div
            class="chat-sidebar-resize"
            style={{ left: `${sidebarWidth() - 4}px` }}
            onMouseDown={handleSidebarResize}
          />
        </>
      )}
      <div class="flex-1 min-w-0 min-h-0">
        <Show
          when={skillsPanelOpen()}
          fallback={
            <Suspense fallback={<div class="p-3 text-14-regular text-text-weak">Loading session...</div>}>
              <SessionProviders>
                <SessionPage />
              </SessionProviders>
            </Suspense>
          }
        >
          <div class="h-full overflow-y-auto" style={{ background: "var(--surface-strong)" }}>
            <SkillsContent />
          </div>
        </Show>
      </div>
    </div>
  )
}