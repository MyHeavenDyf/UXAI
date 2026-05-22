import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/core/util/path"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { focusTerminalById } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { messageAgentColor } from "@/utils/agent"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { StatusPopover } from "../status-popover"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

type OpenApp = (typeof OPEN_APPS)[number]
type OS = "macos" | "windows" | "linux" | "unknown"

const MAC_APPS = [
  {
    id: "vscode",
    label: "session.header.open.app.vscode",
    icon: "vscode",
    openWith: "Visual Studio Code",
  },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "session.header.open.app.textmate", icon: "textmate", openWith: "TextMate" },
  {
    id: "antigravity",
    label: "session.header.open.app.antigravity",
    icon: "antigravity",
    openWith: "Antigravity",
  },
  { id: "terminal", label: "session.header.open.app.terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "session.header.open.app.iterm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "session.header.open.app.ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "warp", label: "session.header.open.app.warp", icon: "warp", openWith: "Warp" },
  { id: "xcode", label: "session.header.open.app.xcode", icon: "xcode", openWith: "Xcode" },
  {
    id: "android-studio",
    label: "session.header.open.app.androidStudio",
    icon: "android-studio",
    openWith: "Android Studio",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "powershell",
    label: "session.header.open.app.powershell",
    icon: "powershell",
    openWith: "powershell",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))
  const os = createMemo(() => detectOS(platform))
  const isDesktopBeta = platform.platform === "desktop" && import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const search = createMemo(() => !isDesktopBeta || settings.general.showSearch())
  const tree = createMemo(() => !isDesktopBeta || settings.general.showFileTree())
  const term = createMemo(() => !isDesktopBeta || settings.general.showTerminal())
  const status = createMemo(() => !isDesktopBeta || settings.general.showStatus())

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const fileManager = createMemo(() => {
    if (os() === "macos") return { label: "session.header.open.finder", icon: "finder" as const }
    if (os() === "windows") return { label: "session.header.open.fileExplorer", icon: "file-explorer" as const }
    return { label: "session.header.open.fileManager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => [app.id, ok] as const),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: language.t(fileManager().label), icon: fileManager().icon },
      ...apps()
        .filter((app) => exists[app.id])
        .map((app) => ({ ...app, label: language.t(app.label) })),
    ] as const
  })

  const toggleTerminal = () => {
    const next = !view().terminal.opened()
    view().terminal.toggle()
    if (!next) return

    const id = terminal.active()
    if (!id) return
    focusTerminalById(id)
  }

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })
  const [openRequest, setOpenRequest] = createStore({
    app: undefined as OpenApp | undefined,
  })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(
    () =>
      options().find((o) => o.id === prefs.app) ??
      options()[0] ??
      ({ id: "finder", label: fileManager().label, icon: fileManager().icon } as const),
  )
  const opening = createMemo(() => openRequest.app !== undefined)
  const tint = createMemo(() =>
    messageAgentColor(params.id ? sync.data.message[params.id] : undefined, sync.data.agent),
  )

  const selectApp = (app: OpenApp) => {
    if (!options().some((item) => item.id === app)) return
    setPrefs("app", app)
  }

  const openDir = (app: OpenApp) => {
    if (opening() || !canOpen() || !platform.openPath) return
    const directory = projectDirectory()
    if (!directory) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    setOpenRequest("app", app)
    platform
      .openPath(directory, openWith)
      .catch((err: unknown) => showRequestError(language, err))
      .finally(() => {
        setOpenRequest("app", undefined)
      })
  }

  const copyPath = () => {
    const directory = projectDirectory()
    if (!directory) return
    navigator.clipboard
      .writeText(directory)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: directory,
        })
      })
      .catch((err: unknown) => showRequestError(language, err))
  }

  const [centerMount, setCenterMount] = createSignal<HTMLElement | null>(null)
  const [rightMount, setRightMount] = createSignal<HTMLElement | null>(null)

  createEffect(() => {
    const center = document.getElementById("opencode-titlebar-center")
    const right = document.getElementById("opencode-titlebar-right")
    if (center) setCenterMount(center)
    if (right) setRightMount(right)
  })

  return (
    <>
      {/* Chat 页原搜索栏，已移至 titlebar-simple.tsx，保留代码以备后续使用 */}
      {/* <Show when={search() && centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <button
              type="button"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
              class="flex items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06] active:bg-black/[0.10]"
              style={{ width: "32px", height: "32px" }}
            >
              <svg viewBox="0 0 14 14" width="20" height="20" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
                <path d="M11.4839 7.14791C11.4288 7.63503 11.3043 8.10251 11.1103 8.55033C10.999 8.80727 11.1135 9.09658 11.3704 9.20787C11.6273 9.31916 11.9167 9.20472 12.028 8.94779C12.2614 8.40871 12.4113 7.8462 12.4776 7.26026C12.5432 6.67949 12.5239 6.10178 12.4194 5.52714C12.3135 4.94442 12.1249 4.391 11.8534 3.86689C11.5729 3.32533 11.2151 2.83703 10.7801 2.40199C10.4681 2.09006 10.1305 1.81861 9.76708 1.58764C9.46873 1.39801 9.15303 1.23567 8.81999 1.10062C8.48353 0.964175 8.14043 0.859916 7.7907 0.78784C7.39908 0.707133 6.99915 0.666779 6.5909 0.666779C6.18266 0.666779 5.78273 0.707131 5.39113 0.787835C5.04139 0.859911 4.69828 0.964172 4.36181 1.10062C4.02875 1.23568 3.71304 1.39803 3.41468 1.58767C3.0513 1.81863 2.71366 2.09007 2.40174 2.40199C2.08983 2.7139 1.81839 3.05154 1.58743 3.41491C1.39779 3.71328 1.23543 4.02899 1.10037 4.36205C0.963928 4.69853 0.859668 5.04163 0.787592 5.39137C0.706887 5.78298 0.666534 6.1829 0.666534 6.59115C0.666534 6.99939 0.706888 7.39933 0.787596 7.79094C0.859672 8.14067 0.963931 8.48377 1.10037 8.82024C1.23543 9.15329 1.39778 9.469 1.58742 9.76737C1.81838 10.1307 2.08982 10.4684 2.40174 10.7803C2.71364 11.0922 3.05126 11.3636 3.41461 11.5946C3.71299 11.7842 4.02873 11.9466 4.36181 12.0817C5.07504 12.3709 5.81807 12.5155 6.5909 12.5155C7.36373 12.5155 8.10676 12.3709 8.81999 12.0817C9.15308 11.9466 9.46881 11.7842 9.76719 11.5946C9.992 11.4517 10.207 11.2933 10.4121 11.1194L12.7713 13.4787C12.9693 13.6767 13.2804 13.6767 13.4784 13.4787C13.6764 13.2807 13.6764 12.9695 13.4784 12.7716L10.7801 10.0732C10.5444 9.8375 10.3087 9.8375 10.073 10.0732C9.80881 10.3373 9.52262 10.5665 9.21441 10.7607C8.97137 10.9139 8.71464 11.0453 8.4442 11.155C7.85147 11.3953 7.2337 11.5155 6.5909 11.5155C5.9481 11.5155 5.33033 11.3953 4.7376 11.155C4.1242 10.9062 3.58129 10.5456 3.10885 10.0732C2.84471 9.80906 2.61553 9.52288 2.42131 9.21467C2.26816 8.97163 2.13675 8.71489 2.02708 8.44444C1.91506 8.16821 1.82914 7.88654 1.76933 7.59943C1.7008 7.27047 1.66653 6.93438 1.66653 6.59115C1.66653 6.24791 1.7008 5.91181 1.76933 5.58285C1.82915 5.29575 1.91506 5.01408 2.02708 4.73785C2.13675 4.4674 2.26816 4.21065 2.42132 3.9676C2.61553 3.6594 2.84471 3.37323 3.10885 3.10909C3.37298 2.84496 3.65914 2.61579 3.96734 2.42157C4.21039 2.26841 4.46715 2.13699 4.7376 2.02732C5.01384 1.9153 5.29552 1.82938 5.58263 1.76957C5.91158 1.70104 6.24767 1.66678 6.5909 1.66678C6.93414 1.66678 7.27023 1.70104 7.59919 1.76958C7.8863 1.82939 8.16797 1.9153 8.4442 2.02732C8.71463 2.13699 8.97137 2.26839 9.2144 2.42154C9.52262 2.61576 9.8088 2.84494 10.073 3.10909C10.2943 3.33045 10.4915 3.56823 10.6647 3.82243C10.7747 3.98393 10.8749 4.15207 10.9654 4.32683C11.1909 4.76202 11.3476 5.22172 11.4355 5.70592C11.5224 6.184 11.5385 6.66467 11.4839 7.14791Z" fill="#191919" fill-rule="evenodd" />
              </svg>
            </button>
          </Portal>
        )}
      </Show> */}
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center" />
          </Portal>
        )}
      </Show>
    </>
  )
}
