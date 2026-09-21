import { Button } from "@opencode-ai/ui/button"
import { DialogProvider, useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useGlobalSDK } from "@/context/global-sdk"
import { mcpQueryKey, useGlobalSync } from "@/context/global-sync"
import { directoryKey } from "@/context/global-sync/utils"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DialogMcpForm } from "./dialog-mcp-form"
import { SettingsList } from "./settings-list"

// 内置 MCP 名单,与 builtin-mcp.ts BUILTIN_MCP_KEYS / desktop ipc.ts 守卫同步(硬编码先例见 mcp-trigger.ts)。
// 服务端通过 BuiltinMCP 注入,不经设置页的写通道管理,仅展示。
const BUILTIN_MCP_NAMES = new Set(["uxr-tool", "pixso"])

const MCP_DELETE_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAALKADAAQAAAABAAAALAAAAAD8buejAAAChklEQVRYCe2YsU0EMRBFD7gYGoAcRAEIciQKQIREUAEhEQUgkdMBogAkchAFIAoAkUMFzEf7Fp+xvfbeHodOHmlke8Yef3+PfesbjapUBioDlYGFYmBpBqvZtZjbpmumz6YPpp+m/042DNGt6bunT9Y+MB1EhmIYsCph9dXqArrXIN1vfE1zvsWVTS9m701XPShnjU/sTy25DCsvxV5MBEr+GIsv5lNOX5qK+ZA8mjHma/vnAhZzOkgp0WQ7kQ7agaOID/OHVbZoxMpxzOHZr61NLnqutnnX1n5XxKwAieWY6DZZPFkpXNKp9T821U0w7d2qFDs31SFVvCxZzur100mTKBd1CKcVYnWl2sQ8pYCVh0MJ11/nzeBOWAqYNAhdcWJM15svSqPQL13qAPox2nYpYNiAnTaQVS5MuY+xa2Gyn2BwSmIQ03HFq6WAiZRiByDqu86AQMkuzRQwwV1QPpaUz+2b288dMypl+K0ZDTtuMPLbtaXq7BIxU31bXylgBobYAbC7GEDhY7xKYhTdPKWAc1IiBCoEmIWFfG6MiXopYA3u+iaYmKCjUcSuYvUBDCMwBCYmZ6tld+v0U8lYYrm+ZH0awD4YJidvNTF1UgkwXHe+HX+07AOYSXzA0UmGdPQBDJNsK3j4nmVBslOnpC9ji640DR4ToaAkV/0heuJsmrIg+W9M9WHv2mRnd/yFyJeUIRnWRD6wmI3cToILOfsAhhW2NRS3yzYXhjnpXeBCfj43WXyoT9CW+2p2B4sd/ZujbdVBC+WomaOiF4teGQIbe2VHB/cBrGBKB/0x0jctBPbQ9E8Ytnm+RWD1ytD7LvcQ6YbRg7N0V2xIlcpAZaAysJAMfAE47GGdQ9Mw9AAAAABJRU5ErkJggg=="
const MCP_EDIT_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAALKADAAQAAAABAAAALAAAAAD8buejAAABw0lEQVRYCe2Xz0kFMRjEo3jWCqzAAkQb0ALEAuQVIFiAFXgXBO+KBQjeFe/KK0DxruDd+fEMhHWN3+aPoHwD82A3yezsvC+bJASHJ+AJeAKeQKcEtqQL/wSO5PLlk1nTKwWvg+CGuFYwNh1yqot3EbPQhCmGV6V4Lm6blPOdDtU8ZvZE9+9yQ5dyjYO2e12vi6/ipfgmluBRg67FYbKYhU2wLxVqLJquFU1rFl1zSVgffKWOCGO8Ft3NYvBGxDCTrQbfmUV3ViM8HEspYJgaLkXO7FyiprJYLn36xHGYSQ2lE2xXbeZP5G8Yzpmd+N4h9Dbc1Cxv19Nwc7M9DTM501mf1izPLUaPhDHLfmNPZFVsZlZaYcpegv4WsMhg+ljcFEuXcA39itYJsxJilv3Cg9jUrPSaJ8yKRbJniPdA65LAbFe0LomuZhF3w70j/rcJx89T7X547A+Imk9jjcN71oQ5g4F0uV3cqfvlm832EmQPn4suIVgPoZyY2cSzb2VRYLll2a0BybJBQpNDLSfpH2E1jBAP4JhPKi1xK7EDMZZdVnuKYYTiX7iTVbU1PqvbhWgqBZuk9/IEPAFPwBPwBAYJfABhhUzrxIm9VwAAAABJRU5ErkJggg=="

// 桌面端 API 子集(preload 暴露的 window.api;类型在 helper 内闭环,先例见 insight/lib/electron-api.ts)
type DesktopApi = {
  mcpConfigWrite?: (input: { op: "set" | "remove"; name: string; value?: Record<string, unknown> }) => Promise<void>
}
const getDesktopApi = () => (window as unknown as { api?: DesktopApi }).api

function DialogDeleteMcp(props: { name: string; onDelete: () => Promise<void>; onClose: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [deleting, setDeleting] = createSignal(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await props.onDelete()
      props.onClose()
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

function McpDeleteDialog(props: {
  deleting: () => { name: string } | undefined
  onDelete: (name: string) => Promise<void>
  onClose: () => void
}) {
  const dialog = useDialog()

  createEffect(
    on(props.deleting, (deleting) => {
      if (!deleting) return
      dialog.show(
        () => (
          <DialogDeleteMcp
            name={deleting.name}
            onDelete={() => props.onDelete(deleting.name)}
            onClose={() => dialog.close()}
          />
        ),
        props.onClose,
      )
    }),
  )

  return null
}

export const SettingsMcp: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const projectDir = useProjectDir()
  const queryClient = useQueryClient()
  const [pending, setPending] = createSignal<string | null>(null)
  const [form, setForm] = createSignal<false | { editing?: { name: string; entry: Record<string, unknown> } }>(false)
  const [deleting, setDeleting] = createSignal<{ name: string }>()

  const entries = createMemo(() =>
    Object.entries((globalSync.data.config.mcp ?? {}) as Record<string, Record<string, unknown>>).sort(
      ([a], [b]) => Number(!BUILTIN_MCP_NAMES.has(a)) - Number(!BUILTIN_MCP_NAMES.has(b)) || a.localeCompare(b),
    ),
  )

  const isDesktop = createMemo(() => platform.platform === "desktop" && !!getDesktopApi()?.mcpConfigWrite)

  // 设置弹窗可能从侧边栏打开(不在任何页面的 SyncProvider 内),因此不使用 useSync,
  // 改为按当前项目目录从 globalSync 的 child store 读 MCP 状态(bootstrap:false 只读不拉起实例,
  // 先例见 sidebar-items.tsx ProjectIcon)。
  const statusOf = (name: string) => {
    const dir = projectDir()
    if (!dir) return undefined
    const [store] = globalSync.peek(dir, { bootstrap: false })
    return store.mcp[name]
  }

  // 服务端仅在成功拉取工具时发布 mcp.tools.changed,连接失败不发事件;查询默认只在窗口
  // 聚焦/显式失效时刷新,否则状态会冻结在启动快照的「连接中」。设置页打开期间轮询失效。
  // 注意:child store 的查询 key 是 directoryKey 规范化路径(Windows 反斜杠→正斜杠),
  // invalidate 必须用同一形态,否则 key 不匹配、失效空转。
  createEffect(() => {
    const timer = setInterval(() => {
      const dir = projectDir()
      if (dir) void queryClient.invalidateQueries({ queryKey: mcpQueryKey(directoryKey(dir)) })
    }, 3000)
    onCleanup(() => clearInterval(timer))
  })
  const statusError = (name: string) => {
    const s = statusOf(name)
    return s?.status === "failed" ? s.error : undefined
  }

  // 写通道:IPC 直改 octo.json mcp 段 → global.dispose 重建实例(重读配置、重连 MCP)→ 刷新查询。
  // dispose 后实例经 global.disposed 事件自动 bootstrap,状态短暂 connecting 后收敛。
  const applyWrite = async (input: { op: "set" | "remove"; name: string; value?: Record<string, unknown> }) => {
    const api = getDesktopApi()?.mcpConfigWrite
    if (!api) throw new Error("mcpConfigWrite unavailable")
    await api(JSON.parse(JSON.stringify(input)) as typeof input)
    await globalSDK.client.global.dispose()
    await queryClient.invalidateQueries({ queryKey: ["config"] })
    const dir = projectDir()
    if (dir) void queryClient.invalidateQueries({ queryKey: mcpQueryKey(directoryKey(dir)) })
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

  const existingNames = (editing?: string) => {
    const existing = new Set<string>([...BUILTIN_MCP_NAMES, ...entries().map(([name]) => name)])
    if (editing) existing.delete(editing)
    return existing
  }

  return (
    <div data-settings-mcp class="flex h-full min-h-0 flex-col">
      <Show
        when={form()}
        fallback={
          <div class="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pb-10">
            <div
              class="sticky top-0 z-10"
              style="background: linear-gradient(to bottom, #fff calc(100% - 12px), transparent);"
            >
              <div class="flex items-center justify-between gap-2 py-3">
                <h2 class="text-14-medium text-text-strong">{language.t("settings.mcp.server.title")}</h2>
                <Button
                  size="large"
                  variant="secondary"
                  icon="plus-small"
                  class="w-[122px] rounded-[4px]! border-0! bg-[#F3F3F3]! font-normal! text-[#191919]! shadow-none! hover:bg-[#E8E8E8]!"
                  disabled={!isDesktop()}
                  onClick={() => setForm({})}
                >
                  {language.t("settings.mcp.server.add")}
                </Button>
              </div>
            </div>

            <SettingsList>
              <Show
                when={entries().length > 0}
                fallback={<div class="py-4 text-14-regular text-text-weak">{language.t("dialog.mcp.empty")}</div>}
              >
                <For each={entries()}>
                  {([name, entry]) => (
                    <div class="flex items-center justify-between gap-3 min-h-[46px] px-4 py-3 rounded-lg bg-[rgba(0,0,0,0.03)]">
                      <div class="flex flex-col min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="text-14-medium text-text-strong truncate">{name}</span>
                          <Show when={pending() === name}>
                            <span class="text-11-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>
                          </Show>
                        </div>
                        <Show when={statusError(name)}>
                          <span class="text-11-regular text-text-weaker truncate mt-1">{statusError(name)}</span>
                        </Show>
                      </div>

                      <div class="flex items-center gap-3 shrink-0">
                        <Show when={!BUILTIN_MCP_NAMES.has(name) && isDesktop()}>
                          <div class="flex items-center gap-3">
                            <button
                              type="button"
                              class="group relative size-[22px] shrink-0 overflow-hidden rounded-[4px] p-0"
                              aria-label={language.t("common.edit")}
                              onClick={() => setForm({ editing: { name, entry } })}
                            >
                              <img class="block size-[22px]" src={MCP_EDIT_ICON} alt="" />
                              <span class="pointer-events-none absolute inset-0 rounded-[4px] group-hover:bg-[rgba(25,25,25,0.05)]" />
                            </button>
                            <button
                              type="button"
                              class="group relative size-[22px] shrink-0 overflow-hidden rounded-[4px] p-0"
                              aria-label={language.t("common.delete")}
                              onClick={() => setDeleting({ name })}
                            >
                              <img class="block size-[22px]" src={MCP_DELETE_ICON} alt="" />
                              <span class="pointer-events-none absolute inset-0 rounded-[4px] group-hover:bg-[rgba(25,25,25,0.05)]" />
                            </button>
                          </div>
                        </Show>
                        <Show when={!BUILTIN_MCP_NAMES.has(name)}>
                          <Switch
                            checked={entry.enabled !== false}
                            disabled={pending() === name || !projectDir() || !isDesktop()}
                            onChange={() => void toggle(name, entry)}
                            hideLabel
                          >
                            {name}
                          </Switch>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </SettingsList>
          </div>
        }
      >
        {(form) => (
          <DialogMcpForm
            editing={form().editing}
            existingNames={existingNames(form().editing?.name)}
            onSubmit={submitForm}
            onClose={() => setForm(false)}
          />
        )}
      </Show>
      <DialogProvider>
        <McpDeleteDialog deleting={deleting} onDelete={remove} onClose={() => setDeleting()} />
      </DialogProvider>
    </div>
  )
}
