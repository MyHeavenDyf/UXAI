import { Popover as Kobalte } from "@kobalte/core/popover"
import { Button } from "@opencode-ai/ui/button"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Component, type JSX, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { ModelTooltip } from "./model-tooltip"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { useDialog } from "@opencode-ai/ui/context/dialog"

type ModelState = ReturnType<typeof useLocal>["model"]

export const DialogSelectModelUnpaid: Component<{ model?: ModelState; children?: JSX.Element }> = (props) => {
  const model = props.model ?? useLocal().model
  const [store, setStore] = createStore({ open: false })
  const language = useLanguage()
  const providers = useProviders()
  const dialog = useDialog()

  const connect = (provider: string) => {
    void import("./dialog-connect-provider").then((x) => {
      dialog.show(() => <x.DialogConnectProvider provider={provider} />)
    })
  }

  const all = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  const visibleList = createMemo(() =>
    model.list().filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id })),
  )

  let listRef: ListRef | undefined
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  return (
    <Kobalte open={store.open} onOpenChange={(next) => setStore("open", next)} placement="top-start" gutter={14}>
      <Kobalte.Trigger as="div" class="group">{props.children}</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content class="flex flex-col rounded-md bg-surface-raised-stronger-non-alpha z-50 outline-none overflow-hidden shadow-[0_4px_12px_0_rgba(0,0,0,0.16)]">
          <div class="flex flex-col p-2 gap-3" onKeyDown={handleKeyDown}>
            <div class="text-14-medium text-text-base px-2.5 hidden">{language.t("dialog.model.unpaid.freeModels.title")}</div>
            <List
              class="[&_[data-slot=list-scroll]]:overflow-visible [&[data-component=list]]:!p-0 [&_[data-slot=list-group]:last-child]:!pb-0 [&_[data-slot=list-group]]:gap-1 [&_[data-slot=list-item]]:!h-9 [&_[data-slot=list-item]]:!px-3 [&_[data-slot=list-item]]:!rounded-[6px] [&_[data-slot=list-item]]:!text-[14px] [&_[data-slot=list-item]]:!leading-[22px] [&_[data-slot=list-item]]:!text-[#191919] [&_[data-slot=list-item]>span]:!truncate [&_[data-slot=list-item]]:mb-1 [&_[data-slot=list-item-selected-icon]]:!hidden [&_[data-slot=list-item][data-active=true]]:!bg-transparent [&_[data-slot=list-item][data-active=true]:hover]:!bg-[rgba(0,0,0,0.1)] [&_[data-slot=list-item][data-selected=true]]:!bg-[rgba(0,0,0,0.05)] [&_[data-slot=list-item]:active]:!bg-[rgba(0,0,0,0.15)]"
              ref={(ref) => (listRef = ref)}
              items={visibleList}
              current={model.current()}
              key={(x) => `${x.provider.id}:${x.id}`}
              itemWrapper={(item, node) => (
                <Tooltip
                  class="w-full"
                  placement="right-start"
                  gutter={12}
                  value={
                    <ModelTooltip
                      model={item}
                      latest={item.latest}
                      free={item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)}
                    />
                  }
                >
                  {node}
                </Tooltip>
              )}
              onSelect={(x) => {
                model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
                  recent: true,
                })
                setStore("open", false)
              }}
            >
              {(i) => (
                <div class="w-full flex items-center gap-x-2.5">
                  <span>{i.name}</span>
                  <Tag>{language.t("model.tag.free")}</Tag>
                  <Show when={i.latest}>
                    <Tag>{language.t("model.tag.latest")}</Tag>
                  </Show>
                </div>
              )}
            </List>
          </div>
          <div class="px-1.5 pb-1.5 hidden">
            <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
              <div class="w-full flex flex-col items-start gap-4 px-1.5 pt-4 pb-4">
                <div class="px-2 text-14-medium text-text-base">{language.t("dialog.model.unpaid.addMore.title")}</div>
                <div class="w-full">
                  <List
                    class="w-full px-0"
                    key={(x) => x?.id}
                    items={providers.popular}
                    activeIcon="plus-small"
                    sortBy={(a, b) => {
                      if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
                        return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
                      return a.name.localeCompare(b.name)
                    }}
                    onSelect={(x) => {
                      if (!x) return
                      connect(x.id)
                    }}
                  >
                    {(i) => (
                      <div class="w-full flex items-center gap-x-3">
                        <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
                        <span>{i.name}</span>
                        <Show when={i.id === "opencode"}>
                          <div class="text-14-regular text-text-weak">{language.t("dialog.provider.opencode.tagline")}</div>
                        </Show>
                        <Show when={i.id === "opencode"}>
                          <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                        </Show>
                        <Show when={i.id === "opencode-go"}>
                          <>
                            <div class="text-14-regular text-text-weak">
                              {language.t("dialog.provider.opencodeGo.tagline")}
                            </div>
                            <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                          </>
                        </Show>
                        <Show when={i.id === "anthropic"}>
                          <div class="text-14-regular text-text-weak">{language.t("dialog.provider.anthropic.note")}</div>
                        </Show>
                      </div>
                    )}
                  </List>
                  <Button
                    variant="ghost"
                    class="w-full justify-start px-[11px] py-3.5 gap-4.5 text-14-medium"
                    icon="dot-grid"
                    onClick={all}
                  >
                    {language.t("dialog.provider.viewAll")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
