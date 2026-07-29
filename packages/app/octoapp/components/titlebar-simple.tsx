import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocation, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { useCommand } from "@/context/command"
import { useProjectDir } from "@/hooks/use-project-dir"
import { TaskList } from "@/components/task-list"
// jk-j60099994-replace-with-titlebar-simple-1-start
// jk-j60099994-replace-with-titlebar-simple-1-end


type TabType = "chat" | "make" | "cowork" | "studio" | "pattern"

const TAB_ITEMS: { key: TabType; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "cowork", label: "Insight" },
  { key: "make", label: "Design" },
  { key: "pattern", label: "Prototype" },
  { key: "studio", label: "Studio" },
]

type TauriDesktopWindow = {
  startDragging?: () => Promise<void>
  toggleMaximize?: () => Promise<void>
}

type TauriThemeWindow = {
  setTheme?: (theme?: "light" | "dark" | null) => Promise<void>
}

type TauriApi = {
  window?: {
    getCurrentWindow?: () => TauriDesktopWindow
  }
  webviewWindow?: {
    getCurrentWebviewWindow?: () => TauriThemeWindow
  }
}

const tauriApi = () => (window as unknown as { __TAURI__?: TauriApi }).__TAURI__
const currentDesktopWindow = () => tauriApi()?.window?.getCurrentWindow?.()
const currentThemeWindow = () => tauriApi()?.webviewWindow?.getCurrentWebviewWindow?.()
const titlebarHeight = 48
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138

export function TitlebarSimple() {
  const platform = usePlatform()
  const theme = useTheme()
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const command = useCommand()
  const layout = useLayout()
  const server = useServer()
  const projectDir = useProjectDir({ mode: "project" })
  // 标签栏在宽度 >= 1024px 时展开，< 1024px 时折叠为下拉
  const [tabsVisible, setTabsVisible] = createSignal(window.innerWidth >= 1024)
  createEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)")
    const update = () => setTabsVisible(mql.matches)
    update()
    mql.addEventListener("change", update)
    onCleanup(() => mql.removeEventListener("change", update))
  })
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [dropdownPos, setDropdownPos] = createSignal({ top: 0, left: 0 })
  let triggerRef: HTMLButtonElement | undefined

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const counterZoom = () => (windows() && titlebarZoom() < 1 ? 1 / titlebarZoom() : 1)
  const minHeight = () => {
    if (mac()) return `${titlebarHeight / zoom()}px`
    if (windows()) return `${titlebarHeight / Math.min(titlebarZoom(), 1)}px`
    return `${titlebarHeight}px`
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const getWin = () => {
    if (platform.platform !== "desktop") return
    return currentDesktopWindow()
  }

  const activeTab = createMemo((): TabType | undefined => {
    const path = location.pathname
    if (path === "/cowork" || path.startsWith("/insight")) return "cowork"
    if (path === "/" || path === "/make" || path.startsWith("/make/")) return "make"
    if (path === "/pattern" || path.startsWith("/pattern/")) return "pattern"
    if (path === "/skills") {
      const source = layout.sidebarSource.get()
      return source === "make" ? "make" : source === "pattern" ? "pattern" : "cowork"
    }
    const dirMatch = path.match(/^\/[^/]+/)
    if (!dirMatch) return undefined

    const tabMatch = path.match(/^\/[^/]+\/(chat|make|cowork|studio)/)
    if (tabMatch) return tabMatch[1] as TabType

    return "chat"
  })

  const getConfigDirSlug = () => {
    const dir = projectDir()
    return dir ? base64Encode(dir) : undefined
  }

  // 检测当前页面是否为"新建对话"状态（URL 中没有 session ID）
  const isCurrentTabNewConversation = createMemo(() => {
    const path = location.pathname
    // chat: /:dir/chat (没有 session ID)
    if (/^\/[^/]+\/chat\/?$/.test(path)) return true
    // make: /make (没有 session ID)
    if (path === "/make") return true
    // insight/cowork: /insight (没有 session ID)
    if (path === "/insight") return true
    // pattern: /pattern (没有 session ID)
    if (path === "/pattern") return true
    return false
  })

  const handleTabClick = (tab: TabType) => {
    const path = location.pathname

    // 获取当前 tab 类型
    const currentTab = activeTab()
    if (currentTab) {
      // 记录当前 tab 是否在"新建对话"状态
      layout.lastSessionPerTab.setNewConversation(currentTab, isCurrentTabNewConversation())
    }

    // 检查目标 tab 是否在"新建对话"状态
    if (layout.lastSessionPerTab.newConversation(tab)) {
      // 目标 tab 之前是新建对话状态，恢复到新建对话
      if (tab === "cowork") {
        navigate("/insight")
        return
      }
      if (tab === "make") {
        navigate("/make")
        return
      }
      if (tab === "pattern") {
        navigate("/pattern")
        return
      }
      if (tab === "chat") {
        const dirSlug = getConfigDirSlug()
        if (dirSlug) navigate(`/${dirSlug}/chat`)
        return
      }
      if (tab === "studio") {
        const dirSlug = getConfigDirSlug()
        if (dirSlug) navigate(`/${dirSlug}/studio`)
        return
      }
    }

    if (tab === "cowork") {
      const cowork = layout.lastSessionPerTab.cowork()
      if (cowork?.id) {
        navigate(`/insight/${cowork.id}`)
      } else {
        navigate("/insight")
      }
      return
    }

    if (tab === "make") {
      const lastDir = server.projects.last()
      if (lastDir) {
        const sessionId = layout.lastSessionPerTab.make(lastDir)
        if (sessionId) {
          navigate(`/make/${sessionId}`)
        } else {
          navigate("/make")
        }
      } else {
        navigate("/make")
      }
      return
    }

    if (tab === "pattern") {
      const pattern = layout.lastSessionPerTab.pattern()
      if (pattern?.id) {
        navigate(`/pattern/${pattern.id}`)
      } else {
        navigate("/pattern")
      }
      return
    }
    
    const dirSlug = getConfigDirSlug()
    if (!dirSlug) return

    const decodedDir = decode64(dirSlug)
    if (!decodedDir) {
      navigate(`/${dirSlug}/${tab}`)
      return
    }

    if (tab === "chat") {
      const lastDir = layout.lastSessionPerTab.lastChatDir() || server.projects.last()
      if (lastDir) {
        const sessionId = layout.lastSessionPerTab.chat(lastDir)
        const slug = base64Encode(lastDir)
        if (sessionId) {
          navigate(`/${slug}/chat/${sessionId}`)
        } else {
          navigate(`/${slug}/chat`)
        }
      } else {
        const fallbackSlug = getConfigDirSlug()
        if (fallbackSlug) navigate(`/${fallbackSlug}/chat`)
      }
      return
    }

    if (tab === "studio") {
       const sessionId = layout.lastSessionPerTab.studio(decodedDir)
      if (sessionId) {
        navigate(`/${dirSlug}/studio/${sessionId}`)
      } else {
        navigate(`/${dirSlug}/studio`)
      }
    }
  }

  const hasActiveTab = createMemo(() => activeTab() !== undefined)

  const activeTabLabel = () => {
    const key = activeTab()
    if (!key) return ""
    return TAB_ITEMS.find((item) => item.key === key)?.label ?? ""
  }

  // Close menu when entering wide mode
  createEffect(() => {
    if (tabsVisible()) setMenuOpen(false)
  })

  // Update dropdown position: below trigger, centered
  createEffect(() => {
    if (!menuOpen()) return
    const update = () => {
      if (!triggerRef) return
      const rect = triggerRef.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    onCleanup(() => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    })
  })

  // Close menu on Escape
  createEffect(() => {
    if (!menuOpen()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    const scheme = theme.colorScheme()
    const value = scheme === "system" ? null : scheme
    const win = currentThemeWindow()
    if (!win?.setTheme) return
    void win.setTheme(value).catch(() => undefined)
  })

  const interactive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const selector = "button, a, input, textarea, select, option, [role='button'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"
    return !!target.closest(selector)
  }

  const drag = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (e.buttons !== 1) return
    if (interactive(e.target)) return
    const win = getWin()
    if (!win?.startDragging) return
    e.preventDefault()
    void win.startDragging().catch(() => undefined)
  }

  const maximize = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (interactive(e.target)) return
    if (e.target instanceof Element && e.target.closest("[data-tauri-decorum-tb]")) return
    const win = getWin()
    if (!win?.toggleMaximize) return
    e.preventDefault()
    void win.toggleMaximize().catch(() => undefined)
  }

  return (
    <header
      class="shrink-0 bg-background-base relative z-31 overflow-hidden flex items-center px-4 border-b border-border-weak-base"
      style={{ "min-height": minHeight(), height: minHeight(), width:"100%", "justify-content": "space-between" }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <div class="flex items-center shrink-0 gap-2" style={{ zoom: counterZoom() }}>
        <Show when={mac()}>
          <div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />
        </Show>
        <img src="/headerLogo.png" alt="" style={{ width: "90px", height: "18px" }} />
      </div>

      <style>{`
        .titlebar-tab-btn [data-component="icon"] { color: inherit }
        .octo-dropdown-trigger {
          display: inline-flex; align-items: center; gap: 8px;
          cursor: pointer;
          height: 28px; background: transparent; border: none;
          border-radius: var(--octo-radius-sm, 6px);
          color: #191919;
          font-size: 14px; cursor: pointer; width: auto; padding: 0 4px;
          transition: background 100ms cubic-bezier(0.4,0,0.2,1), color 100ms cubic-bezier(0.4,0,0.2,1);
        }
        .octo-dropdown-trigger.octo-dropdown-open { color: var(--octo-text-primary, #1f2937); }
        .octo-dropdown-trigger > svg { flex-shrink: 0; }
        .octo-dropdown-trigger > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .octo-dropdown-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
        .octo-dropdown-menu {
          position: fixed; z-index: 99999;
          display: flex; flex-direction: column; gap: 4px;
          padding: 4px; background: #ffffff;
          border: 1px solid #E5E7EB; border-radius: 8px;
          box-shadow: 0 4px 12px 0 rgba(0,0,0,0.16);
          animation: octo-pop-in 120ms cubic-bezier(0.23,1,0.32,1);
        }
        @keyframes octo-pop-in { from { opacity: 0; } to { opacity: 1; } }
        .octo-dropdown-menu .octo-dropdown-item {
          display: flex; align-items: center; justify-content: center;
          min-width: 80px; height: 36px; padding: 0 10px;
          background: transparent; border: none; border-radius: 6px;
          color: rgba(0,0,0,0.9); font-size: 14px; line-height: 22px;
          cursor: pointer; text-align: center;
          transition: background 100ms cubic-bezier(0.4,0,0.2,1), color 100ms cubic-bezier(0.4,0,0.2,1);
        }
        .octo-dropdown-menu .octo-dropdown-item:hover { background: rgba(0,0,0,0.05); }
        .octo-dropdown-menu .octo-dropdown-item-active,
        .octo-dropdown-menu .octo-dropdown-item-active:hover {
          color: var(--octo-brand, #0a59f7);
          background: var(--octo-brand-a8, rgba(10,89,247,0.08));
        }
      `}</style>
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ zoom: counterZoom() }}>
        <Show
          when={tabsVisible()}
          fallback={
            <div class="relative">
              <button
                ref={triggerRef}
                type="button"
                class={`octo-dropdown-trigger ${menuOpen() ? "octo-dropdown-open" : ""}`}
                disabled={!hasActiveTab()}
                onClick={() => setMenuOpen(!menuOpen())}
              >
                <span>{activeTabLabel()}</span>
                <svg width="12" height="12" viewBox="0 0 10 10" style={{ transform: menuOpen() ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <Show when={menuOpen()}>
                <Portal>
                  <div class="fixed inset-0 z-[40]" onClick={() => setMenuOpen(false)} />
                  <div
                    class="octo-dropdown-menu"
                    style={{
                      top: `${dropdownPos().top}px`,
                      left: `${dropdownPos().left}px`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    {TAB_ITEMS.map((item) => (
                      <button
                        type="button"
                        class={`octo-dropdown-item ${activeTab() === item.key ? "octo-dropdown-item-active" : ""}`}
                        onClick={() => { handleTabClick(item.key); setMenuOpen(false) }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </Portal>
              </Show>
            </div>
          }
        >
          <div class="flex items-center rounded-full bg-[rgba(0,0,0,0.05)] gap-1 p-[2px]" role="tablist">
            {TAB_ITEMS.map((item) => (
              <button
                class="titlebar-tab-btn"
                role="tab"
                aria-selected={activeTab() === item.key}
                disabled={!hasActiveTab()}
                classList={{
                  "flex items-center justify-center gap-1 rounded-full transition-colors": true,
                  "w-[106px] h-[28px]": true,
                  "text-14-regular": true,
                  "bg-[#FFFFFF] text-[rgba(10,89,247,1)]": activeTab() === item.key,
                  "text-text-weak hover:text-text-base": activeTab() !== item.key && hasActiveTab(),
                  "text-text-disabled": !hasActiveTab(),
                  "cursor-pointer": hasActiveTab(),
                  "cursor-not-allowed": !hasActiveTab(),
                }}
                onClick={() => {
                  if (hasActiveTab()) handleTabClick(item.key)
                }}
              >
                <Icon name={`tab-${item.key}` as any} size="small"/>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </Show>
      </div>

      <div
        class="flex items-center min-w-0 justify-end shrink-0"
        data-tauri-drag-region
        onMouseDown={drag}
        style={{ zoom: counterZoom() }}
      >
        <div id="opencode-titlebar-center" class="flex items-center shrink-0 justify-end">
          <Show when={hasActiveTab()}>
            <button
              type="button"
              aria-label={language.t("session.header.searchFiles")}
              class="flex items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06] active:bg-black/[0.10]"
              style={{ width: "32px", height: "32px", display: "none" }}
            >
              <svg viewBox="0 0 14 14" width="20" height="20" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
                <path d="M11.4839 7.14791C11.4288 7.63503 11.3043 8.10251 11.1103 8.55033C10.999 8.80727 11.1135 9.09658 11.3704 9.20787C11.6273 9.31916 11.9167 9.20472 12.028 8.94779C12.2614 8.40871 12.4113 7.8462 12.4776 7.26026C12.5432 6.67949 12.5239 6.10178 12.4194 5.52714C12.3135 4.94442 12.1249 4.391 11.8534 3.86689C11.5729 3.32533 11.2151 2.83703 10.7801 2.40199C10.4681 2.09006 10.1305 1.81861 9.76708 1.58764C9.46873 1.39801 9.15303 1.23567 8.81999 1.10062C8.48353 0.964175 8.14043 0.859916 7.7907 0.78784C7.39908 0.707133 6.99915 0.666779 6.5909 0.666779C6.18266 0.666779 5.78273 0.707131 5.39113 0.787835C5.04139 0.859911 4.69828 0.964172 4.36181 1.10062C4.02875 1.23568 3.71304 1.39803 3.41468 1.58767C3.0513 1.81863 2.71366 2.09007 2.40174 2.40199C2.08983 2.7139 1.81839 3.05154 1.58743 3.41491C1.39779 3.71328 1.23543 4.02899 1.10037 4.36205C0.963928 4.69853 0.859668 5.04163 0.787592 5.39137C0.706887 5.78298 0.666534 6.1829 0.666534 6.59115C0.666534 6.99939 0.706888 7.39933 0.787596 7.79094C0.859672 8.14067 0.963931 8.48377 1.10037 8.82024C1.23543 9.15329 1.39778 9.469 1.58742 9.76737C1.81838 10.1307 2.08982 10.4684 2.40174 10.7803C2.71364 11.0922 3.05126 11.3636 3.41461 11.5946C3.71299 11.7842 4.02873 11.9466 4.36181 12.0817C5.07504 12.3709 5.81807 12.5155 6.5909 12.5155C7.36373 12.5155 8.10676 12.3709 8.81999 12.0817C9.15308 11.9466 9.46881 11.7842 9.76719 11.5946C9.992 11.4517 10.207 11.2933 10.4121 11.1194L12.7713 13.4787C12.9693 13.6767 13.2804 13.6767 13.4784 13.4787C13.6764 13.2807 13.6764 12.9695 13.4784 12.7716L10.7801 10.0732C10.5444 9.8375 10.3087 9.8375 10.073 10.0732C9.80881 10.3373 9.52262 10.5665 9.21441 10.7607C8.97137 10.9139 8.71464 11.0453 8.4442 11.155C7.85147 11.3953 7.2337 11.5155 6.5909 11.5155C5.9481 11.5155 5.33033 11.3953 4.7376 11.155C4.1242 10.9062 3.58129 10.5456 3.10885 10.0732C2.84471 9.80906 2.61553 9.52288 2.42131 9.21467C2.26816 8.97163 2.13675 8.71489 2.02708 8.44444C1.91506 8.16821 1.82914 7.88654 1.76933 7.59943C1.7008 7.27047 1.66653 6.93438 1.66653 6.59115C1.66653 6.24791 1.7008 5.91181 1.76933 5.58285C1.82915 5.29575 1.91506 5.01408 2.02708 4.73785C2.13675 4.4674 2.26816 4.21065 2.42132 3.9676C2.61553 3.6594 2.84471 3.37323 3.10885 3.10909C3.37298 2.84496 3.65914 2.61579 3.96734 2.42157C4.21039 2.26841 4.46715 2.13699 4.7376 2.02732C5.01384 1.9153 5.29552 1.82938 5.58263 1.76957C5.91158 1.70104 6.24767 1.66678 6.5909 1.66678C6.93414 1.66678 7.27023 1.70104 7.59919 1.76958C7.8863 1.82939 8.16797 1.9153 8.4442 2.02732C8.71463 2.13699 8.97137 2.26839 9.2144 2.42154C9.52262 2.61576 9.8088 2.84494 10.073 3.10909C10.2943 3.33045 10.4915 3.56823 10.6647 3.82243C10.7747 3.98393 10.8749 4.15207 10.9654 4.32683C11.1909 4.76202 11.3476 5.22172 11.4355 5.70592C11.5224 6.184 11.5385 6.66467 11.4839 7.14791Z" fill="#191919" fill-rule="evenodd" />
              </svg>
            </button>
          </Show>
        </div>
        <TaskList />
        {/* jk// jk-j60099994-replace-with-titlebar-simple-2-start */}
        <img src="/AvatarUser.svg" alt="" class="header-user-icon" />
        {/* jk-j60099994-replace-with-titlebar-simple-2-end */}
        <Show when={windows()}>
          {!tauriApi() && <div class="shrink-0" style={{ width: windowsControlsWidth() }} />}
          <div data-tauri-decorum-tb class="flex flex-row" />
        </Show>
      </div>
    </header>
  )
}
