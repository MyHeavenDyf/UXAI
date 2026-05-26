import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { createMemo, type Component, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useModels } from "@/context/models"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { DialogSelectDefaultModel } from "./dialog-select-default-model"
import { SettingsList } from "./settings-list"

export const SettingsDefaultModel: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const models = useModels()
  const providers = useProviders()

  const validModel = (model: { providerID: string; modelID: string }) => {
    const provider = providers.all().find((item) => item.id === model.providerID)
    if (!provider?.models[model.modelID]) return false
    const connected = new Set(providers.connected().map((item) => item.id))
    return connected.has(model.providerID)
  }

  const currentModelKey = createMemo(() => {
    const modelStr = globalSync.data.config.model
    if (modelStr) {
      const [providerID, modelID] = modelStr.split("/")
      if (providerID && modelID && validModel({ providerID, modelID })) return { providerID, modelID }
    }

    for (const item of models.recent.list()) {
      if (validModel(item)) return item
    }

    const defaults = providers.default()
    for (const provider of providers.connected()) {
      const configured = defaults[provider.id]
      if (configured && validModel({ providerID: provider.id, modelID: configured }))
        return { providerID: provider.id, modelID: configured }

      const first = Object.values(provider.models)[0]
      if (first && validModel({ providerID: provider.id, modelID: first.id }))
        return { providerID: provider.id, modelID: first.id }
    }

    return undefined
  })

  const currentModel = createMemo(() => {
    const key = currentModelKey()
    if (!key) return undefined
    return models.find(key)
  })

  const handleSelect = () => {
    dialog.show(() => <DialogSelectDefaultModel />)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.defaultModel.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.defaultModel.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.defaultModel.section.current")}</h3>
          <SettingsList>
            <div class="flex items-center justify-between gap-4 min-h-16 py-3 px-4">
              <Show
                when={currentModel()}
                fallback={
                  <span class="text-14-regular text-text-weak">
                    {language.t("settings.defaultModel.notSet")}
                  </span>
                }
              >
                {(model) => (
                  <div class="flex items-center gap-3 min-w-0">
                    <ProviderIcon id={model().provider.id} class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong truncate">{model().name}</span>
                    <span class="text-12-regular text-text-weak">{model().provider.name}</span>
                  </div>
                )}
              </Show>
              <div class="flex items-center gap-2 shrink-0">
                <Button size="large" variant="secondary" onClick={handleSelect}>
                  {currentModel()
                    ? language.t("settings.defaultModel.change")
                    : language.t("settings.defaultModel.select")}
                </Button>
              </div>
            </div>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-12-regular text-text-weak">{language.t("settings.defaultModel.hint")}</p>
        </div>
      </div>
    </div>
  )
}