import { createEffect, createMemo, Show } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { Button } from "@opencode-ai/ui/button"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useLocation, useNavigate } from "@solidjs/router"
import { Logo } from "@opencode-ai/ui/logo"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useGlobalSync } from "@/context/global-sync"
// jk-j60099994-replace-with-titlebar-simple-1-start
// jk-j60099994-replace-with-titlebar-simple-1-end
type TabType = "chat" | "cowork" | "studio"

const TAB_ITEMS: { key: TabType; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "cowork", label: "Cowork" },
  { key: "studio", label: "Studio" },
]

const TAB_ICON_MAP: Record<TabType, { default: string; selected: string }> = {
  chat: { default: "/IconChat.svg", selected: "/IconChat1.svg" },
  cowork: { default: "/IconCowork.svg", selected: "/IconCowork1.svg" },
  studio: { default: "/IconStudio.svg", selected: "/IconStudio1.svg" },
}

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
const titlebarHeight = 64
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138

export function TitlebarSimple() {
  const platform = usePlatform()
  const theme = useTheme()
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const globalSync = useGlobalSync()
  const server = useServer()

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
    if (path.startsWith("/insight") || path.startsWith("/make") || path === "/skills") return "cowork"
    const dirMatch = path.match(/^\/[^/]+/)
    if (!dirMatch) return undefined

    const tabMatch = path.match(/^\/[^/]+\/(chat|cowork|studio)/)
    if (tabMatch) return tabMatch[1] as TabType

    return "chat"
  })

  const handleTabClick = (tab: TabType) => {
    const path = location.pathname
    // For Cowork tab, navigate to /insight
    if (tab === "cowork") {
      const idMatch = path.match(/\/insight\/([^/]+)/)
      const id = idMatch ? idMatch[1] : ""
      navigate(`/insight${id ? `/${id}` : ""}`)
      return
    }
    // Get dir slug: from URL path or from globalSync directory
    // Skip "insight" and "make" which are standalone routes, not directory slugs
    const dirMatch = path.match(/^\/([^/]+)/)
    let dir = dirMatch ? dirMatch[1] : ""
    if (!dir || dir === "insight" || dir === "make" || dir === "skills") {
      const last = server.projects.last()
      const directory = last && last !== "/" && !/^[A-Z]:\\?$/.test(last) 
        ? last 
        : globalSync.data.path.home
      dir = directory ? base64Encode(directory) : ""
    }
    if (!dir) return
    const idMatch = path.match(/\/(chat)\/([^/]+)/)
    const id = idMatch ? idMatch[2] : ""

    const targetUrl = `/${dir}/${tab}${id ? `/${id}` : ""}`
    navigate(targetUrl)
  }

  const hasActiveTab = createMemo(() => activeTab() !== undefined)

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
      class="shrink-0 bg-background-base relative overflow-hidden flex items-center px-4 border-b border-border-weak-base"
      style={{ "min-height": minHeight(), height: minHeight() }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <div class="flex items-center shrink-0 gap-2" style={{ zoom: counterZoom() }}>
        <Show when={mac()}>
          <div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />
        </Show>
        <img src="/OctoLogo.svg" alt="" style={{ width: "26px", height: "24px" }} />
        <span class="text-16-medium text-text-strong">Octo AI</span>
      </div>

      <div class="flex-1 flex items-center justify-center min-w-0" style={{ zoom: counterZoom() }}>
        <div class="flex items-center rounded-full bg-[rgba(0,0,0,0.05)] gap-1 p-[2px]" role="tablist">
          {TAB_ITEMS.map((item) => (
            <button
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
              <img
                src={activeTab() === item.key ? TAB_ICON_MAP[item.key].selected : TAB_ICON_MAP[item.key].default}
                alt=""
                style={{ width: "18px", height: "18px", display: "block" }}
              />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        class="flex items-center min-w-0 justify-end shrink-0"
        data-tauri-drag-region
        onMouseDown={drag}
        style={{ zoom: counterZoom() }}
      >
        <div id="opencode-titlebar-center" class="flex items-center shrink-0 justify-end">
          <Show when={activeTab() === "cowork" || activeTab() === "studio"}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="hidden md:flex w-[240px] max-w-full min-w-0 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default"
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center overflow-visible">
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.searchFiles")}
                </span>
              </div>
            </Button>
          </Show>
        </div>
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
