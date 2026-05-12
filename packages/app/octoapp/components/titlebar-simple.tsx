import { createEffect, createMemo, Show } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useLocation, useNavigate } from "@solidjs/router"
import { Logo } from "@opencode-ai/ui/logo"

type TabType = "chat" | "cowork" | "studio"

const TAB_ITEMS: { key: TabType; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "cowork", label: "Cowork" },
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
const titlebarHeight = 64
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138

export function TitlebarSimple() {
  const platform = usePlatform()
  const theme = useTheme()
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()

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
    const dirMatch = path.match(/^\/[^/]+/)
    if (!dirMatch) return undefined
    
    const tabMatch = path.match(/^\/[^/]+\/(chat|cowork|studio)/)
    if (tabMatch) return tabMatch[1] as TabType
    
    return "chat"
  })

  const handleTabClick = (tab: TabType) => {
    const path = location.pathname
    const match = path.match(/^\/([^/]+)/)
    if (!match) return
    const dir = match[1]
    const idMatch = path.match(/\/(chat|cowork)\/([^/]+)/)
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
      <div class="flex items-center shrink-0" style={{ zoom: counterZoom() }}>
        <Show when={mac()}>
          <div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />
        </Show>
        <Logo class="w-8 h-8" />
      </div>

      <div class="flex-1 flex items-center justify-center min-w-0" style={{ zoom: counterZoom() }}>
        <div class="flex items-center rounded-full bg-[rgba(0,0,0,0.05)] p-1" role="tablist">
          {TAB_ITEMS.map((item) => (
            <button
              role="tab"
              aria-selected={activeTab() === item.key}
              disabled={!hasActiveTab()}
              classList={{
                "flex items-center justify-center gap-2 rounded-full transition-colors": true,
                "w-[106px] h-[32px]": true,
                "text-14-regular": true,
                "bg-[#FFFFFF] text-[rgba(10,89,247,1)]": activeTab() === item.key,
                "text-text-weak hover:text-text-base": activeTab() !== item.key && hasActiveTab(),
                "text-text-disabled": !hasActiveTab(),
                "cursor-pointer": hasActiveTab(),
                "cursor-not-allowed": !hasActiveTab(),
              }}
              onClick={() => { if (hasActiveTab()) handleTabClick(item.key) }}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mount points for SessionHeader to render via Portal */}
      <div class="flex items-center min-w-0 justify-end shrink-0 gap-2" data-tauri-drag-region onMouseDown={drag} style={{ zoom: counterZoom() }}>
        <div id="opencode-titlebar-center" class="flex items-center shrink-0 md:w-[260px]" />
        <div id="opencode-titlebar-right" class="flex items-center shrink-0 gap-2" />
        <Show when={windows()}>
          {!tauriApi() && <div class="shrink-0" style={{ width: windowsControlsWidth() }} />}
          <div data-tauri-decorum-tb class="flex flex-row" />
        </Show>
      </div>
    </header>
  )
}