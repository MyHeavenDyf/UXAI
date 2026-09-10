import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, For, Show, type Component, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useGlobalSDK } from "@/context/global-sdk"
import { mcpQueryKey, useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { Link } from "@/components/link"
import { DialogMcpForm } from "./dialog-mcp-form"
import { DialogSettings } from "./dialog-settings"
import { SettingsList } from "./settings-list"

// 内置 MCP 名单,与 builtin-mcp.ts BUILTIN_MCP_KEYS / desktop ipc.ts 守卫同步(硬编码先例见 mcp-trigger.ts)。
// 服务端通过 BuiltinMCP 注入,不经设置页的写通道管理,仅展示。
const BUILTIN_MCP_NAMES = new Set(["uxr-tool", "pixso"])

// 桌面端 API 子集(preload 暴露的 window.api;类型在 helper 内闭环,先例见 insight/lib/electron-api.ts)
type DesktopApi = {
  mcpConfigWrite?: (input: { op: "set" | "remove"; name: string; value?: Record<string, unknown> }) => Promise<void>
}
const getDesktopApi = () => (window as unknown as { api?: DesktopApi }).api

const statusLabels = {
  connected: "mcp.status.connected",
  connecting: "mcp.status.connecting",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

const rowStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-wrap": "wrap",
  "align-items": "center",
  "justify-content": "space-between",
  gap: "4px",
  padding: "12px 16px",
  background: "rgba(0, 0, 0, 0.03)",
  "border-radius": "8px",
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

const blueBtn: JSX.CSSProperties = {
  height: "28px",
  padding: "0 12px",
  "background-color": "#0a59f7",
  border: "none",
  "border-radius": "8px",
  "font-size": "12px",
  "line-height": "20px",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
}

function DialogDeleteMcp(props: { name: string; onDelete: () => Promise<void> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [deleting, setDeleting] = createSignal(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await props.onDelete()
      dialog.show(() => <DialogSettings initialTab="mcp" />)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog title={language.t("settings.mcp.delete.title")} fit class="delete-dialog">
      <div class="flex flex-col gap-4">
        <span class="text-14-regular text-text-strong">
          {language.t("settings.mcp.delete.confirm", { name: props.name })}
        </span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            class="delete-dialog-btn delete-dialog-btn-primary"
            disabled={deleting()}
            onClick={handleDelete}
          >
            {language.t("common.delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export const SettingsMcp: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const projectDir = useProjectDir()
  const queryClient = useQueryClient()
  const [pending, setPending] = createSignal<string | null>(null)

  const entries = createMemo(() =>
    Object.entries((globalSync.data.config.mcp ?? {}) as Record<string, Record<string, unknown>>),
  )
  const builtinEntries = createMemo(() => entries().filter(([name]) => BUILTIN_MCP_NAMES.has(name)))
  const customEntries = createMemo(() => entries().filter(([name]) => !BUILTIN_MCP_NAMES.has(name)))

  const isDesktop = createMemo(() => platform.platform === "desktop" && !!getDesktopApi()?.mcpConfigWrite)

  const uiType = (entry: Record<string, unknown>) => {
    if (entry.type === "local") return language.t("settings.mcp.type.stdio")
    if (entry.type === "remote")
      return entry.transport === "sse" ? language.t("settings.mcp.type.sse") : language.t("settings.mcp.type.http")
    return
  }

  // 设置弹窗可能从侧边栏打开(不在任何页面的 SyncProvider 内),因此不使用 useSync,
  // 改为按当前项目目录从 globalSync 的 child store 读 MCP 状态(bootstrap:false 只读不拉起实例,
  // 先例见 sidebar-items.tsx ProjectIcon)。
  const statusOf = (name: string) => {
    const dir = projectDir()
    if (!dir) return undefined
    const [store] = globalSync.peek(dir, { bootstrap: false })
    return store.mcp[name]
  }
  const statusLabel = (name: string) => {
    const status = statusOf(name)?.status
    const key = status ? statusLabels[status as keyof typeof statusLabels] : undefined
    return key ? language.t(key) : undefined
  }
  const statusError = (name: string) => {
    const s = statusOf(name)
    return s?.status === "failed" ? s.error : undefined
  }

  // 写通道:IPC 直改 octo.json mcp 段 → global.dispose 重建实例(重读配置、重连 MCP)→ 刷新查询。
  // dispose 后实例经 global.disposed 事件自动 bootstrap,状态短暂 connecting 后收敛。
  const applyWrite = async (input: { op: "set" | "remove"; name: string; value?: Record<string, unknown> }) => {
    const api = getDesktopApi()?.mcpConfigWrite
    if (!api) throw new Error("mcpConfigWrite unavailable")
    await api(input)
    await globalSDK.client.global.dispose()
    await queryClient.invalidateQueries({ queryKey: ["config"] })
    const dir = projectDir()
    if (dir) void queryClient.invalidateQueries({ queryKey: mcpQueryKey(dir) })
  }

  const withPending = async (name: string, task: () => Promise<void>) => {
    if (pending()) return
    setPending(name)
    try {
      await task()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("settings.mcp.toast.failed.title"), description: message })
    } finally {
      setPending(null)
    }
  }

  const toggle = (name: string, entry: Record<string, unknown>) =>
    withPending(name, async () => {
      await applyWrite({ op: "set", name, value: { ...entry, enabled: entry.enabled === false } })
    })

  const remove = (name: string) =>
    withPending(name, async () => {
      await applyWrite({ op: "remove", name })
      showToast({ variant: "success", icon: "circle-check", title: language.t("settings.mcp.toast.deleted.title") })
    })

  const submitForm = async (name: string, value: Record<string, unknown>) => {
    await applyWrite({ op: "set", name, value })
    showToast({ variant: "success", icon: "circle-check", title: language.t("settings.mcp.toast.saved.title") })
  }

  const openForm = (editing?: { name: string; entry: Record<string, unknown> }) => {
    const existing = new Set<string>([...BUILTIN_MCP_NAMES, ...entries().map(([name]) => name)])
    if (editing) existing.delete(editing.name)
    dialog.show(() => <DialogMcpForm editing={editing} existingNames={existing} onSubmit={submitForm} />)
  }

  const hoverWhite = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    e.currentTarget.style.setProperty("background-color", "rgba(0,0,0,0.03)")
    e.currentTarget.style.setProperty("border-color", "transparent")
  }
  const unhoverWhite = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    e.currentTarget.style.setProperty("background-color", "#fff")
    e.currentTarget.style.setProperty("border-color", "#c9c9c9")
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-10">
      <div class="sticky top-0 z-10" style="background: linear-gradient(to bottom, #fff calc(100% - 24px), transparent);">
        <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
          {language.t("settings.mcp.title")}
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <div class="flex flex-col gap-1">
          <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
            {language.t("settings.mcp.section.builtin")}
          </div>
          <SettingsList>
            <Show
              when={builtinEntries().length > 0}
              fallback={<div class="py-4 text-14-regular text-text-weak">{language.t("settings.mcp.builtin.empty")}</div>}
            >
              <For each={builtinEntries()}>
                {([name, entry]) => (
                  <div style={rowStyle}>
                    <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                        <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{name}</span>
                        <Tag>{language.t("settings.mcp.tag.builtin")}</Tag>
                        <Show when={statusLabel(name)}>
                          <span class="text-11-regular text-text-weaker">{statusLabel(name)}</span>
                        </Show>
                      </div>
                      <Show when={statusError(name)}>
                        <span class="text-11-regular text-text-weaker truncate" style={{ "margin-top": "4px" }}>
                          {statusError(name)}
                        </span>
                      </Show>
                      <Show when={entry.homepage || entry.docs}>
                        <div style={{ display: "flex", gap: "12px", "margin-top": "4px" }}>
                          <Show when={typeof entry.homepage === "string" && entry.homepage}>
                            {(href) => (
                              <Link href={href()} class="text-12-regular text-text-weak no-underline!">
                                {language.t("settings.mcp.link.homepage")}
                              </Link>
                            )}
                          </Show>
                          <Show when={typeof entry.docs === "string" && entry.docs}>
                            {(href) => (
                              <Link href={href()} class="text-12-regular text-text-weak no-underline!">
                                {language.t("settings.mcp.link.docs")}
                              </Link>
                            )}
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
            {language.t("settings.mcp.section.custom")}
          </div>
          <SettingsList>
            <Show
              when={customEntries().length > 0}
              fallback={<div class="py-4 text-14-regular text-text-weak">{language.t("settings.mcp.custom.empty")}</div>}
            >
              <For each={customEntries()}>
                {([name, entry]) => (
                  <div style={rowStyle}>
                    <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                        <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{name}</span>
                        <Show when={uiType(entry)}>
                          <Tag>{uiType(entry)}</Tag>
                        </Show>
                        <Show when={statusLabel(name)}>
                          <span class="text-11-regular text-text-weaker">{statusLabel(name)}</span>
                        </Show>
                        <Show when={pending() === name}>
                          <span class="text-11-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>
                        </Show>
                      </div>
                      <Show when={statusError(name)}>
                        <span class="text-11-regular text-text-weaker truncate" style={{ "margin-top": "4px" }}>
                          {statusError(name)}
                        </span>
                      </Show>
                    </div>
                    <Show
                      when={isDesktop()}
                      fallback={<span class="text-12-regular text-text-weaker">{language.t("settings.mcp.custom.desktopOnly")}</span>}
                    >
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <button
                          type="button"
                          style={whiteBtn}
                          onClick={() => openForm({ name, entry })}
                          onMouseEnter={hoverWhite}
                          onMouseLeave={unhoverWhite}
                        >
                          {language.t("common.edit")}
                        </button>
                        <button
                          type="button"
                          style={whiteBtn}
                          onClick={() => dialog.show(() => <DialogDeleteMcp name={name} onDelete={() => remove(name)} />)}
                          onMouseEnter={hoverWhite}
                          onMouseLeave={unhoverWhite}
                        >
                          {language.t("common.delete")}
                        </button>
                        <Switch
                          checked={entry.enabled !== false}
                          disabled={pending() === name}
                          onChange={() => void toggle(name, entry)}
                        />
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>

            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "4px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px", "flex-wrap": "wrap" }}>
              <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>
                  {language.t("settings.mcp.custom.add")}
                </span>
                <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)", "margin-top": "4px" }}>
                  {language.t("settings.mcp.custom.add.description")}
                </span>
              </div>
              <Show
                when={isDesktop()}
                fallback={<span class="text-12-regular text-text-weaker">{language.t("settings.mcp.custom.desktopOnly")}</span>}
              >
                <button
                  type="button"
                  style={blueBtn}
                  onClick={() => openForm()}
                  onMouseEnter={(e) => e.currentTarget.style.setProperty("background-color", "#0950de")}
                  onMouseLeave={(e) => e.currentTarget.style.setProperty("background-color", "#0a59f7")}
                >
                  {language.t("settings.mcp.custom.add")}
                </button>
              </Show>
            </div>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}
