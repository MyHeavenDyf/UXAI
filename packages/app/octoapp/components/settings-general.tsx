import { Component, Show, createEffect, createMemo, createResource, createSignal, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { usePlatform, type DisplayBackend } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useServer } from "@/context/server"
import { useLayout } from "@/context/layout"
import { useProjectDir } from "@/hooks/use-project-dir"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/context/settings"
import { decode64 } from "@/utils/base64"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { showFloatingNotice } from "./floating-notice"
import { Link } from "./link"
import { SettingsList } from "./settings-list"
import { DialogUpdateAvailable, MAC_UPDATE_DOWNLOAD_URL } from "./dialog-update-available"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type ThemeOption = {
  id: string
  name: string
}

type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

type ShellSelectOption = {
  id: string
  value: string
  label: string
}

type ProxyOption = {
  id: string
  group: string
  label: string
  host: string
}

const PROXY_OPTIONS: ProxyOption[] = [
  { id: "normal", group: "普通", label: "普通", host: "proxy" },
  { id: "non-rd-cn", group: "非研发", label: "中国", host: "proxycn2" },
  { id: "non-rd-nanjing", group: "非研发", label: "南京", host: "proxyn" },
  { id: "non-rd-hk", group: "非研发", label: "香港", host: "proxyhk" },
  { id: "non-rd-uk", group: "非研发", label: "英国", host: "proxvuk" },
  { id: "non-rd-us", group: "非研发", label: "美国", host: "proxyus" },
  { id: "non-rd-us-nrd", group: "非研发", label: "美国", host: "proxyus-nrd" },
  { id: "non-rd-ru", group: "非研发", label: "俄罗斯", host: "proxyru" },
  { id: "non-rd-br", group: "非研发", label: "巴西", host: "proxybr" },
  { id: "non-rd-bh", group: "非研发", label: "巴林", host: "proxybh" },
  { id: "non-rd-blr", group: "非研发", label: "印度", host: "proxyblr" },
  { id: "non-rd-open", group: "非研发", label: "开放代理", host: "openproxy" },
  { id: "non-rd-za", group: "非研发", label: "南非", host: "proxyza" },
  { id: "non-rd-tr", group: "非研发", label: "土耳其", host: "proxytr" },
  { id: "non-rd-ca", group: "非研发", label: "加拿大", host: "proxyca" },
  { id: "non-rd-de", group: "非研发", label: "德国", host: "proxyde" },
  { id: "rd-jp", group: "研发", label: "日本", host: "proxyjp" },
  { id: "rd-cn", group: "研发", label: "中国", host: "proxycn2" },
  { id: "rd-se", group: "研发", label: "瑞典", host: "proxvse-rd" },
  { id: "rd-de", group: "研发", label: "德国", host: "proxyde-rd" },
  { id: "rd-tr", group: "研发", label: "土耳其", host: "proxytr-rd" },
  { id: "rd-us", group: "研发", label: "美国", host: "proxvus-rd" },
  { id: "rd-open", group: "研发", label: "开放代理", host: "openproxy" },
  { id: "rd-ru", group: "研发", label: "俄罗斯", host: "proxyru-rd" },
]

const DEFAULT_PROXY_OPTION = PROXY_OPTIONS.find((option) => option.id === "non-rd-hk")!

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

const whiteBtn: JSX.CSSProperties = {
  height: "28px",
  padding: "0 12px",
  "background-color": "#fff",
  border: "1px solid #c9c9c9",
  "border-radius": "8px",
  "font-size": "12px",
  "line-height": "20px",
  color: "rgba(0,0,0,0.9)",
  cursor: "pointer",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  gap: "4px",
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const permission = usePermission()
  const platform = usePlatform()
  const params = useParams()
  const settings = useSettings()
  const server = useServer()

  const [store, setStore] = createStore({
    checking: false,
  })

  const [proxyAccount, setProxyAccount] = createSignal("")
  const [proxyPassword, setProxyPassword] = createSignal("")
  const [proxyPasswordVisible, setProxyPasswordVisible] = createSignal(false)
  const [proxyNoProxy, setProxyNoProxy] = createSignal("")
  const [proxyOption, setProxyOption] = createSignal(DEFAULT_PROXY_OPTION)
  const [proxyConfiguring, setProxyConfiguring] = createSignal(false)
  const proxyButtonActive = createMemo(() => !proxyConfiguring() && Boolean(proxyAccount()) && Boolean(proxyPassword()))

  const configureProxy = async () => {
    const api = (window as any).api
    if (!api?.configureProxy) {
      showToast({ title: "当前环境不支持代理配置" })
      return
    }
    setProxyConfiguring(true)
    try {
      const result = await api.configureProxy(proxyAccount(), proxyPassword(), proxyNoProxy(), proxyOption().host, proxyOption().id)
      if (result.success) {
        showFloatingNotice("success", "配置成功，请重启以完成设置")
      } else {
        showToast({ variant: "error", title: "配置值不正确" })
      }
    } catch (err) {
      showToast({ variant: "error", title: "配置值不正确" })
    } finally {
      setProxyConfiguring(false)
    }
  }

  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const dir = createMemo(() => {
    const fromParams = decode64(params.dir)
    if (fromParams) return fromParams
    return server.projects.last() || ""
  })
  const accepting = createMemo(() => {
    const value = dir()
    if (!value) return false
    if (!params.id) return permission.isAutoAcceptingDirectory(value)
    return permission.isAutoAccepting(params.id, value)
  })

  const toggleAccept = (checked: boolean) => {
    const value = dir()
    if (!value) return

    if (!params.id) {
      if (permission.isAutoAcceptingDirectory(value) === checked) return
      permission.toggleAutoAcceptDirectory(value)
      return
    }

    if (checked) {
      permission.enableAutoAccept(params.id, value)
      return
    }

    permission.disableAutoAccept(params.id, value)
  }
  const desktop = createMemo(() => platform.platform === "desktop")
  const dialog = useDialog()

  const check = () => {
    if (!platform.checkUpdate) return
    setStore("checking", true)

    void platform
      .checkUpdate()
      .then((result) => {
        if (!result.updateAvailable) {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("settings.updates.toast.latest.title"),
            description: language.t("settings.updates.toast.latest.description", { version: platform.version ?? "" }),
          })
          return
        }

        dialog.show(() => (
          <DialogUpdateAvailable
            os={platform.os === "macos" ? "macos" : "windows"}
            version={result.version ?? ""}
            onUpgrade={() => {
              if (platform.os === "macos") {
                platform.openLink(MAC_UPDATE_DOWNLOAD_URL)
                return
              }
              return platform.updateAndRestart?.()
            }}
          />
        ))
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("checking", false))
  }

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const globalSync = useGlobalSync()
  const globalSdk = useGlobalSDK()

  const [shells] = createResource(
    () =>
      globalSdk.client.pty
        .shells()
        .then((res) => res.data ?? [])
        .catch(() => [] as ShellOption[]),
    { initialValue: [] as ShellOption[] },
  )

  const [displayBackend, { refetch: refetchDisplayBackend }] = createResource(
    () => (linux() && platform.getDisplayBackend ? true : false),
    () => Promise.resolve(platform.getDisplayBackend?.() ?? null).catch(() => null as DisplayBackend | null),
    { initialValue: null as DisplayBackend | null },
  )

  onMount(() => {
    void theme.loadThemes()

    const api = (window as any).api
    if (!api?.getProxyConfig) return

    void api
      .getProxyConfig()
      .then((config: { account: string; password: string; proxyHost?: string; proxyOptionId?: string; noProxy?: string } | null) => {
        if (!config) return
        setProxyAccount(config.account)
        setProxyPassword(config.password)
        const savedHost = config.proxyHost?.replace(/\.huawei\.com(?::\d+)?$/, "")
        const savedOption = (config.proxyOptionId ? PROXY_OPTIONS.find((option) => option.id === config.proxyOptionId) : undefined)
          ?? (savedHost ? PROXY_OPTIONS.find((option) => option.host === savedHost) : undefined)
        if (savedOption) setProxyOption(savedOption)
        if (config.noProxy) setProxyNoProxy(config.noProxy)
      })
      .catch(() => {})
  })

  const autoOption = { id: "auto", value: "", label: language.t("settings.general.row.shell.autoDefault") }
  const currentShell = createMemo(() => globalSync.data.config.shell ?? "")

  const shellOptions = createMemo<ShellSelectOption[]>(() => {
    const list = shells.latest
    const current = globalSync.data.config.shell

    const nameCounts = new Map<string, number>()
    for (const s of list) {
      nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1)
    }

    const options = [
      autoOption,
      ...list.map((s) => {
        const ambiguousName = (nameCounts.get(s.name) || 0) > 1
        const text = ambiguousName ? s.path : s.name
        const label = s.acceptable ? text : `${text} (${language.t("settings.general.row.shell.terminalOnly")})`
        return {
          id: s.path,
          // Prefer name over path - "bash" is much cleaner than the explicit full route even when it may change due to PATH.
          value: ambiguousName ? s.path : s.name,
          label,
        }
      }),
    ]

    if (current && !options.some((o) => o.value === current)) {
      options.push({ id: current, value: current, label: current })
    }

    return options
  })

  const onDisplayBackendChange = (checked: boolean) => {
    const update = platform.setDisplayBackend?.(checked ? "wayland" : "auto")
    if (!update) return
    void update.finally(() => {
      void refetchDisplayBackend()
    })
  }

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales
      .filter((locale) => locale === "en" || locale === "zh")
      .map((locale) => ({
        value: locale,
        label: language.label(locale),
      })),
  )

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())
  const terminal = () => terminalInput(settings.appearance.terminalFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const GeneralSection = () => {
    const server = useServer()
    const platform = usePlatform()
    const layout = useLayout()
    const currentProjectDir = () => server.projects.last()

    const handlechangeProjectDir = async () => {
      if (!platform.openDirectoryPickerDialog) return
      const result = await platform.openDirectoryPickerDialog()
      if (result && typeof result === "string") {
        server.projects.touch(result)
        layout.projects.open(result)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.general.projectDir.changed"),
        })
      }
    }

    return (
      <div class="flex flex-col gap-1">
        <SettingsList>
          <SettingsRow
            title={language.t("settings.general.projectDir")}
            description={language.t("settings.general.projectDir.description")}
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-13-regular text-text-weak truncate max-w-[200px]" title={currentProjectDir()}>
                {currentProjectDir() || language.t("settings.general.projectDir.notSet")}
              </span>
              <button
                type="button"
                style={whiteBtn}
                onClick={handlechangeProjectDir}
                onMouseEnter={(e) => e.currentTarget.style.setProperty("border-color", "#191919")}
                onMouseLeave={(e) => e.currentTarget.style.setProperty("border-color", "#c9c9c9")}
                onMouseDown={(e) => e.currentTarget.style.setProperty("border-color", "#0a59f7")}
                onMouseUp={(e) => e.currentTarget.style.setProperty("border-color", "#191919")}
              >
                {language.t("settings.general.projectDir.change")}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow
          title={language.t("settings.general.row.language.title")}
          description={language.t("settings.general.row.language.description")}
        >
          <Select
            data-action="settings-language"
            options={languageOptions()}
            current={languageOptions().find((o) => o.value === language.locale())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && language.setLocale(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("command.permissions.autoaccept.enable")}
          description={language.t("toast.permissions.autoaccept.on.description")}
        >
          <div data-action="settings-auto-accept-permissions">
            <Switch checked={accepting()} disabled={!dir()} onChange={toggleAccept} />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shell.title")}
          description={language.t("settings.general.row.shell.description")}
        >
          <Select
            data-action="settings-shell"
            options={shellOptions()}
            current={shellOptions().find((o) => o.value === currentShell()) ?? autoOption}
            value={(o) => o.id}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentShell()) return
              globalSync.updateConfig({ shell: option.value })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "180px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSessionProgressBar.title")}
          description={language.t("settings.general.row.showSessionProgressBar.description")}
        >
          <div data-action="settings-show-session-progress-bar">
            <Switch
              checked={settings.general.showSessionProgressBar()}
              onChange={(checked) => settings.general.setShowSessionProgressBar(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )
  }

  const AdvancedSection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.general.section.advanced")}</div>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showNavigation.title")}
          description={language.t("settings.general.row.showNavigation.description")}
        >
          <div data-action="settings-show-navigation">
            <Switch
              checked={settings.general.showNavigation()}
              onChange={(checked) => settings.general.setShowNavigation(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showTerminal.title")}
          description={language.t("settings.general.row.showTerminal.description")}
        >
          <div data-action="settings-show-terminal">
            <Switch
              checked={settings.general.showTerminal()}
              onChange={(checked) => settings.general.setShowTerminal(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
    )

  const AppearanceSection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.general.section.appearance")}</div>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.uiFont.title")}
          description={language.t("settings.general.row.uiFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-ui-font"
              label={language.t("settings.general.row.uiFont.title")}
              hideLabel
              type="text"
              value={sans()}
              onChange={(value) => settings.appearance.setUIFont(value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.font.title")}
          description={language.t("settings.general.row.font.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-code-font"
              label={language.t("settings.general.row.font.title")}
              hideLabel
              type="text"
              value={mono()}
              onChange={(value) => settings.appearance.setFont(value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.terminalFont.title")}
          description={language.t("settings.general.row.terminalFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-terminal-font"
              label={language.t("settings.general.row.terminalFont.title")}
              hideLabel
              type="text"
              value={terminal()}
              onChange={(value) => settings.appearance.setTerminalFont(value)}
              placeholder={terminalDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": terminalFontFamily(settings.appearance.terminalFont()) }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const NotificationsSection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.general.section.notifications")}</div>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const SoundsSection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.general.section.sounds")}</div>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.sounds.agent.title")}
          description={language.t("settings.general.sounds.agent.description")}
        >
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.permissions.title")}
          description={language.t("settings.general.sounds.permissions.description")}
        >
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.errors.title")}
          description={language.t("settings.general.sounds.errors.description")}
        >
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const UpdatesSection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.general.section.updates")}</div>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.updates.row.startup.title")}
          description={language.t("settings.updates.row.startup.description")}
        >
          <div data-action="settings-updates-startup">
            <Switch
              checked={settings.updates.startup()}
              disabled={!platform.checkUpdate}
              onChange={(checked) => settings.updates.setStartup(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.releaseNotes.title")}
          description={language.t("settings.general.row.releaseNotes.description")}
        >
          <div data-action="settings-release-notes">
            <Switch
              checked={settings.general.releaseNotes()}
              onChange={(checked) => settings.general.setReleaseNotes(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.updates.row.check.title")}
          description={language.t("settings.updates.row.check.description")}
        >
          <Button size="small" variant="secondary" disabled={store.checking || !platform.checkUpdate} onClick={check}>
            {store.checking
              ? language.t("settings.updates.action.checking")
              : language.t("settings.updates.action.checkNow")}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const ProxySection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>Proxy</div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
        <div class="flex items-center gap-2">
          <span style={{ "white-space": "nowrap", color: "rgba(0,0,0,0.6)", "font-size": "12px", "line-height": "20px" }}>代理节点:</span>
          <Select
            options={PROXY_OPTIONS}
            current={proxyOption()}
            value={(option) => option.id}
            label={(option) => option.label}
            groupBy={(option) => option.group}
            onSelect={(option) => option && setProxyOption(option)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "180px" }}
          />
          <Button
            size="small"
            variant="secondary"
            disabled={!proxyButtonActive()}
            onClick={configureProxy}
            style={{
              width: "88px",
              "margin-left": "auto",
              border: proxyButtonActive() ? "1px solid #3D78FB" : "1px solid rgba(201,201,201,1)",
              "background-color": proxyButtonActive() ? "#3D78FB" : undefined,
              color: proxyButtonActive() ? "#FFFFFF" : undefined,
              "font-size": "12px",
              "line-height": "20px",
            }}
          >
            {proxyConfiguring() ? "配置中..." : "配置"}
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <span style={{ "white-space": "nowrap", color: "rgba(0,0,0,0.6)", "font-size": "12px", "line-height": "20px" }}>W3账号：</span>
          <input
            type="text"
            value={proxyAccount()}
            onInput={(e) => setProxyAccount(e.currentTarget.value)}
            onFocus={(e) => e.currentTarget.style.borderColor = "#0a59f7"}
            onBlur={(e) => e.currentTarget.style.borderColor = "rgba(201,201,201,1)"}
            placeholder="请输入账号"
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            style={{
              "height": "28px",
              "border": "1px solid rgba(201,201,201,1)",
              "border-radius": "4px",
              "padding": "4px 12px",
              "flex": "1",
              "outline": "none",
              "font-size": "12px",
              "line-height": "20px",
              background: "#fff",
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span style={{ "white-space": "nowrap", color: "rgba(0,0,0,0.6)", "font-size": "12px", "line-height": "20px" }}>W3密码：</span>
          <div style={{ position: "relative", flex: "1" }}>
            <input
              type={proxyPasswordVisible() ? "text" : "password"}
              value={proxyPassword()}
              onInput={(e) => setProxyPassword(e.currentTarget.value)}
              onFocus={(e) => e.currentTarget.style.borderColor = "#0a59f7"}
              onBlur={(e) => e.currentTarget.style.borderColor = "rgba(201,201,201,1)"}
              placeholder="请输入密码"
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              style={{
                height: "28px",
                width: "100%",
                border: "1px solid rgba(201,201,201,1)",
                "border-radius": "4px",
                padding: "4px 36px 4px 12px",
                outline: "none",
                "font-size": "12px",
                "line-height": "20px",
                background: "#fff",
              }}
            />
            <button
              type="button"
              aria-label={proxyPasswordVisible() ? "隐藏密码" : "显示密码"}
              title={proxyPasswordVisible() ? "隐藏密码" : "显示密码"}
              onClick={() => setProxyPasswordVisible((visible) => !visible)}
              style={{
                position: "absolute",
                top: "0",
                right: "0",
                width: "32px",
                height: "28px",
                padding: "0",
                border: "none",
                background: "transparent",
                color: "rgba(0,0,0,0.6)",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
              }}
            >
              <Show
                when={proxyPasswordVisible()}
                fallback={
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M3 3L17 17" stroke="currentColor" stroke-linecap="round" />
                    <path d="M8.3 4.9C8.85 4.7 9.42 4.58 10 4.58C14.17 4.58 17.5 10 17.5 10C16.75 11.2 15.82 12.35 14.76 13.28M11.7 15.1C11.15 15.3 10.58 15.42 10 15.42C5.83 15.42 2.5 10 2.5 10C3.25 8.8 4.18 7.65 5.24 6.72" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                }
              >
                <Icon name="eye" size="small" />
              </Show>
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span style={{ "white-space": "nowrap", color: "rgba(0,0,0,0.6)", "font-size": "12px", "line-height": "20px" }}>跳过代理:</span>
          <input
            type="text"
            value={proxyNoProxy()}
            onInput={(e) => setProxyNoProxy(e.currentTarget.value)}
            onFocus={(e) => e.currentTarget.style.borderColor = "#0a59f7"}
            onBlur={(e) => e.currentTarget.style.borderColor = "rgba(201,201,201,1)"}
            placeholder="(可选)"
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            style={{
              "height": "28px",
              "border": "1px solid rgba(201,201,201,1)",
              "border-radius": "4px",
              "padding": "4px 12px",
              "flex": "1",
              "outline": "none",
              "font-size": "12px",
              "line-height": "20px",
              background: "#fff",
            }}
          />
        </div>
        <div class="flex items-center gap-2">
          <span aria-hidden="true" style={{ visibility: "hidden", "white-space": "nowrap", "font-size": "12px", "line-height": "20px" }}>W3账号：</span>
          <label class="flex items-center gap-2" style={{ width: "fit-content", color: "rgba(0,0,0,0.6)", "font-size": "12px", "line-height": "20px", cursor: "pointer" }}>
            <input
              type="radio"
              name="proxy-remember-choice"
              checked
              style={{
                appearance: "none",
                "-webkit-appearance": "none",
                width: "12px",
                height: "12px",
                margin: "0",
                border: "3px solid #0a59f7",
                "border-radius": "50%",
                "box-sizing": "border-box",
                "flex-shrink": "0",
              }}
            />
            <span>记住我的选择</span>
          </label>
        </div>
      </div>
    </div>
  )

  // ── SPEC-INS-031 Chat 历史会话迁移(临时功能:chat → insight 的一次性搬家)──────────
  // 迁移只改会话归属(agent / directory / project_id 三列),对话内容一字不动;服务端在迁移
  // 前会先备份整库并校验,任一步不确定都中止并明确报错。退场时整节连同两个接口一起删。
  const projectDir = useProjectDir()
  const [migrateDir, setMigrateDir] = createSignal("")
  const [migrating, setMigrating] = createSignal(false)
  // pending = 还没迁的 chat 历史;migratable = 备份里可重迁的(> 0 时按钮变「重新迁移」)。
  const [migrateCounts, setMigrateCounts] = createSignal({ pending: 0, migratable: 0 })

  // 默认填当前全局选中目录,用户可二次修改(改过之后不被 projectDir 变化覆盖)。
  createEffect(() => {
    const dir = projectDir()
    if (dir && !migrateDir()) setMigrateDir(dir)
  })

  const loadMigrateCounts = async () => {
    const dir = migrateDir() || projectDir()
    if (!dir) return
    try {
      const api = globalSdk.client.insight?.chatMigration
      if (!api) return
      const result = await api.preview({ body_directory: dir, query_directory: dir })
      const data = result.data
      if (!data) return
      setMigrateCounts({ pending: Number(data.pending) || 0, migratable: Number(data.migratable) || 0 })
    } catch (err) {
      // 预览失败只是拿不到条数,不该让设置页报错:按钮仍可点,真正的结论以迁移结果为准。
      console.warn("[settings:chat-migrate] preview failed", err)
    }
  }
  onMount(() => void loadMigrateCounts())

  const pickMigrateDir = async () => {
    if (!platform.openDirectoryPickerDialog) return
    const result = await platform.openDirectoryPickerDialog()
    if (result && typeof result === "string") setMigrateDir(result)
  }

  const runChatMigration = async () => {
    const dir = migrateDir()
    if (!dir) {
      showToast({ variant: "error", title: "请先选择目标文件夹" })
      return
    }
    setMigrating(true)
    try {
      const api = globalSdk.client.insight?.chatMigration
      if (!api) {
        showToast({ variant: "error", title: "当前版本不支持该功能，请更新后重试" })
        return
      }
      const result = await api.run({ body_directory: dir, query_directory: dir })
      if (!result.data) {
        const reason = (result.error as { data?: { message?: string } } | undefined)?.data?.message
        showToast({ variant: "error", title: `迁移失败：${reason ?? "请稍后重试"}` })
        return
      }
      const migrated = Number(result.data.migrated) || 0
      if (migrated === 0) {
        showToast({ title: "没有需要迁移的 Chat 历史会话" })
      } else {
        const folder = dir.split(/[/\\]/).filter(Boolean).pop() ?? dir
        // 备份是整库副本、体积等同当前数据库,且不会自动清理 —— 告诉用户它在哪,才谈得上
        // 「用完自行删除」。放 description 不放 title:路径很长,标题要保持可读。
        const backupPath = typeof result.data.backupPath === "string" ? result.data.backupPath : ""
        showToast({
          variant: "success",
          title: `已迁移 ${migrated} 条 Chat 历史会话到 ${folder}`,
          description: backupPath ? `迁移前的数据已备份到 ${backupPath}，确认无误后可自行删除` : undefined,
        })
      }
      await loadMigrateCounts()
    } catch (err) {
      showToast({ variant: "error", title: `迁移失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setMigrating(false)
    }
  }

  const migrateButtonLabel = () => {
    if (migrating()) return "迁移中..."
    return migrateCounts().pending === 0 && migrateCounts().migratable > 0 ? "重新迁移" : "开始迁移"
  }

  const ChatMigrationSection = () => (
    <div class="flex flex-col gap-1">
      <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>Chat 历史会话迁移</div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
        <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)" }}>
          把 Chat 的历史会话移入所选文件夹，移入后可在Insight会话列表中打开查看。对话内容不会改变。
        </span>
        <div class="flex items-center gap-2">
          <input
            type="text"
            value={migrateDir()}
            readOnly
            title={migrateDir()}
            placeholder="请选择目标文件夹"
            spellcheck={false}
            style={{
              "height": "28px",
              "border": "1px solid rgba(201,201,201,1)",
              "border-radius": "4px",
              "padding": "4px 12px",
              "flex": "1",
              "min-width": "0",
              "outline": "none",
              "font-size": "12px",
              "line-height": "20px",
              "text-overflow": "ellipsis",
            }}
          />
          <Button
            size="small"
            variant="secondary"
            disabled={migrating() || !platform.openDirectoryPickerDialog}
            onClick={pickMigrateDir}
            style={{ "border": "1px solid rgba(201,201,201,1)", "font-size": "12px", "line-height": "20px" }}
          >
            选择…
          </Button>
        </div>
        <Show when={migrateCounts().pending > 0}>
          <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)" }}>
            待迁移 {migrateCounts().pending} 条
          </span>
        </Show>
        <Button
          size="small"
          variant="secondary"
          disabled={migrating() || !migrateDir()}
          onClick={runChatMigration}
          style={{ width: "88px", "border": "1px solid rgba(201,201,201,1)", "font-size": "12px", "line-height": "20px" }}
        >
          {migrateButtonLabel()}
        </Button>
      </div>
    </div>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-10 sm:pb-10">
      <div class="sticky top-0 z-10" style="background: linear-gradient(to bottom, #fff calc(100% - 12px), transparent);">
        <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
          {language.t("settings.tab.general")}
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />

        <UpdatesSection />

        <Show when={linux()}>
          <div class="flex flex-col gap-1">
            <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.general.section.display")}</div>

            <SettingsList>
              <SettingsRow
                title={
                  <div class="flex items-center gap-2">
                    <span>{language.t("settings.general.row.wayland.title")}</span>
                    <Tooltip value={language.t("settings.general.row.wayland.tooltip")} placement="top">
                      <span class="text-text-weak">
                        <Icon name="help" size="small" />
                      </span>
                    </Tooltip>
                  </div>
                }
                description={language.t("settings.general.row.wayland.description")}
              >
                <div data-action="settings-wayland">
                  <Switch checked={displayBackend.latest === "wayland"} onChange={onDisplayBackendChange} />
                </div>
              </SettingsRow>
            </SettingsList>
          </div>
        </Show>

        <Show when={desktop() && import.meta.env.VITE_OPENCODE_CHANNEL === "beta"}>
          <AdvancedSection />
        </Show>

        <ProxySection />

        <ChatMigrationSection />
      </div>
    </div>
)
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
      <div style={{ display: "flex", "min-width": 0, flex: 1, "flex-direction": "column", gap: "4px" }}>
        <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{props.title}</span>
        <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)" }}>{props.description}</span>
      </div>
      <div style={{ display: "flex", "align-items": "center", "flex-shrink": 0 }}>{props.children}</div>
    </div>
  )
}
