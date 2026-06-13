import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { SettingsList } from "./settings-list"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const connected = createMemo(() => {
    const disabled = new Set(globalSync.data.config.disabled_providers ?? [])
    return providers.connected().filter((p) => !disabled.has(p.id))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    // 预置供应商被 disable 后会从后端列表消失，补充合成条目让用户可以重新连接
    const ids = new Set(items.map((p) => p.id))
    for (const pid of ["opencode", "bpit"]) {
      if (!connectedIDs.has(pid) && !ids.has(pid)) {
        items.push({ id: pid, name: pid === "opencode" ? "Octo AI" : pid } as ProviderItem)
      }
    }
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    const before = globalSync.data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]

    await globalSync
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const hasApiKey = (providerID: string) => {
    return Boolean(globalSync.data.config.provider?.[providerID]?.options?.apiKey)
  }

  const disconnectOpencode = async (name: string) => {
    await globalSDK.client.auth.remove({ providerID: "opencode" }).catch(() => undefined)
    const provider = globalSync.data.config.provider ?? {}
    const next = { ...provider }
    if (next.opencode?.options) {
      const { apiKey: _, ...rest } = next.opencode.options
      next.opencode = { ...next.opencode, options: Object.keys(rest).length > 0 ? rest : undefined }
    }
    await globalSync.updateConfig({ provider: next })
    await globalSDK.client.global.dispose()
    await disableProvider("opencode", name)
    globalSync.invalidateProviders()
  }

  const disconnect = async (providerID: string, name: string) => {
    await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)

    const provider = globalSync.data.config.provider ?? {}
    const next = { ...provider }
    if (next[providerID]?.options?.apiKey) {
      const { apiKey: _, ...rest } = next[providerID].options
      next[providerID] = { ...next[providerID], options: Object.keys(rest).length > 0 ? rest : undefined }
    }

    const before = globalSync.data.config.disabled_providers ?? []
    const nextDisabled = before.includes(providerID) ? before : [...before, providerID]

    await globalSDK.client.global.config.update({ config: { provider: next, disabled_providers: nextDisabled } })
    await globalSDK.client.global.dispose()
    globalSync.invalidateProviders()

    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
      description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-10 sm:pb-10">
      <div class="sticky top-0 z-10" style="background: linear-gradient(to bottom, #fff calc(100% - 24px), transparent);">
        <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
          {language.t("settings.providers.title")}
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.providers.section.connected")}</div>
          <SettingsList>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="group" style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", "justify-content": "space-between", gap: "4px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "12px", "min-width": 0 }}>
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{item.name}</span>
                      <Tag>{type(item)}</Tag>
                    </div>
                    <Show when={item.id === "opencode"}>
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <Button size="large" variant="secondary" onClick={() => {
                          dialog.show(() => <DialogConnectProvider provider="opencode" />)
                        }}>
                          {hasApiKey("opencode")
                            ? language.t("common.edit")
                            : language.t("common.connect")}
                        </Button>
                        <Show when={hasApiKey("opencode")}>
                          <Button size="large" variant="ghost" onClick={() => void disconnectOpencode(item.name)}>
                            {language.t("common.disconnect")}
                          </Button>
                        </Show>
                      </div>
                    </Show>
                    <Show when={item.id !== "opencode"}>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                          {language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <Button size="large" variant="ghost" onClick={() => void disconnect(item.id, item.name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>{language.t("settings.providers.section.popular")}</div>
          <SettingsList>
            <For each={popular()}>
              {(item) => (
                <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", "justify-content": "space-between", gap: "4px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
                  <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{item.name}</span>
                      <Show when={item.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                      <Show when={item.id === "opencode-go"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={note(item.id)}>
                      {(key) => <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)", "margin-top": "4px" }}>{language.t(key())}</span>}
                    </Show>
                  </div>
                  <Button
                    size="large"
                    variant="secondary"
                    icon="plus-small"
                    onClick={() => {
                      dialog.show(() => <DialogConnectProvider provider={item.id} />)
                    }}
                  >
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>

            <div
              style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "4px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px", "flex-wrap": "wrap" }}
              data-component="custom-provider-section"
            >
              <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "12px" }}>
                  <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
                  <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{language.t("provider.custom.title")}</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)", "margin-top": "4px" }}>
                  {language.t("settings.providers.custom.description")}
                </span>
              </div>
              <Button
                size="large"
                variant="secondary"
                icon="plus-small"
                onClick={() => {
                  dialog.show(() => <DialogCustomProvider back="close" />)
                }}
              >
                {language.t("common.connect")}
              </Button>
            </div>
          </SettingsList>

          <Button
            variant="ghost"
            class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
            onClick={() => {
              dialog.show(() => <DialogSelectProvider />)
            }}
          >
            {language.t("dialog.provider.viewAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}
