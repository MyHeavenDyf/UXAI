import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders } from "@/hooks/use-providers"
import { SettingsList } from "./settings-list"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

const ListLoadingState: Component<{ label: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.label}</span>
    </div>
  )
}

const ListEmptyState: Component<{ message: string; filter: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.message}</span>
      <Show when={props.filter}>
        <span class="text-14-regular text-text-strong mt-1">&quot;{props.filter}&quot;</span>
      </Show>
    </div>
  )
}

export const SettingsModels: Component = () => {
  const language = useLanguage()
  const models = useModels()

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar pb-10 sm:pb-10">
      <div class="sticky top-0 z-10" style="background: linear-gradient(to bottom, #fff calc(100% - 12px), transparent);">
        <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
          {language.t("settings.models.title")}
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px", "margin-bottom": "12px" }}>
          <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
          <TextField
            variant="ghost"
            type="text"
            value={list.filter()}
            onChange={list.onInput}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            class="flex-1"
          />
          <Show when={list.filter()}>
            <IconButton icon="circle-x" variant="ghost" onClick={list.clear} />
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Show
          when={!list.grouped.loading}
          fallback={
            <ListLoadingState label={`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`} />
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={<ListEmptyState message={language.t("dialog.model.empty")} filter={list.filter()} />}
          >
            <For each={list.grouped.latest}>
              {(group) => (
                  <div class="flex flex-col gap-1">
                    <div style={{ display: "flex", "align-items": "center", gap: "12px", "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold", padding: "12px 0" }}>
                      <ProviderIcon id={group.category} class="size-5 shrink-0 icon-strong-base" />
                      <span>{group.items[0].provider.name}</span>
                    </div>
                  <SettingsList>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", "justify-content": "space-between", gap: "4px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
                            <div style={{ "min-width": 0 }}>
                              <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>{item.name}</span>
                            </div>
                            <div style={{ "flex-shrink": 0 }}>
                              <Switch
                                checked={models.visible(key)}
                                onChange={(checked) => {
                                  models.setVisibility(key, checked)
                                }}
                                hideLabel
                              >
                                {item.name}
                              </Switch>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </SettingsList>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}
