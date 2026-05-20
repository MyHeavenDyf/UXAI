import { Component, createMemo, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useModels } from "@/context/models"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { popularProviders } from "@/hooks/use-providers"
import { ModelTooltip } from "./model-tooltip"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

export const DialogSelectDefaultModel: Component<{
  onSelect?: (model: { providerID: string; modelID: string }) => void
}> = (props) => {
  const dialog = useDialog()
  const models = useModels()
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const visibleModels = createMemo(() =>
    models
      .list()
      .filter((m) => models.visible({ modelID: m.id, providerID: m.provider.id })),
  )

  const currentModel = () => {
    const modelStr = globalSync.data.config.model
    if (!modelStr) return undefined
    const [providerID, modelID] = modelStr.split("/")
    if (!providerID || !modelID) return undefined
    return models.find({ providerID, modelID })
  }

  const handleSelect = (model: { id: string; provider: { id: string } } | undefined) => {
    if (!model) return
    const modelStr = `${model.provider.id}/${model.id}`
    globalSync.updateConfig({ model: modelStr }).then(() => {
      props.onSelect?.({ providerID: model.provider.id, modelID: model.id })
      dialog.close()
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    })
  }

  return (
    <Dialog title={language.t("settings.defaultModel.select.title")}>
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 p-1"
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
        key={(x) => `${x.provider.id}:${x.id}`}
        items={visibleModels}
        current={currentModel()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.name}
        sortGroupsBy={(a, b) => {
          const aProvider = a.items[0].provider.id
          const bProvider = b.items[0].provider.id
          if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
          if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
          return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
        }}
        itemWrapper={(item, node) => (
          <Tooltip
            class="w-full"
            placement="right-start"
            gutter={12}
            value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
          >
            {node}
          </Tooltip>
        )}
        onSelect={handleSelect}
      >
        {(i) => (
          <div class="w-full flex items-center gap-x-2 text-13-regular">
            <span class="truncate">{i.name}</span>
            <Show when={isFree(i.provider.id, i.cost)}>
              <Tag>{language.t("model.tag.free")}</Tag>
            </Show>
            <Show when={i.latest}>
              <Tag>{language.t("model.tag.latest")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}