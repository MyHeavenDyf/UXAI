import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createMemo, JSX, Show, ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { StudioVideoRiskDialog } from "@/pages/studio/studio-video-risk-dialog"
import { Portal } from "solid-js/web"

type ModelState = ReturnType<typeof useLocal>["model"]

type RiskModel = { id: string; provider: { id: string }; isExternal?: boolean }

const isExternalModel = (x: { isExternal?: boolean }) => !!x.isExternal

type RiskStore = { open: boolean; pending: RiskModel | undefined }

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  onExternalRisk?: (model: RiskModel) => void
  action?: JSX.Element
  model?: ModelState
  search?: boolean
  groupHeader?: (group: { category: string; items: unknown[] }) => null
}> = (props) => {
  const model = props.model ?? useLocal().model
  const language = useLanguage()

  const models = createMemo(() =>
    model
      .list()
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true)),
  )

  const confirmSelect = (x: RiskModel | undefined) => {
    console.log("[model-select] confirmSelect", x?.id, "isExternal=", x?.isExternal)
    model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
      recent: true,
    })
    props.onSelect()
  }

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={props.search ?? { placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
      groupHeader={props.groupHeader}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={model.current()}
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
          value={<ModelTooltip model={item} />}
        >
          {node}
        </Tooltip>
      )}
      onSelect={(x) => {
        console.log("[model-select] onSelect", x?.id, "isExternal=", x?.isExternal, "isExt=", x ? isExternalModel(x) : false)
        if (x && isExternalModel(x)) {
          props.onExternalRisk?.(x)
          return
        }
        confirmSelect(x)
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-2 text-13-regular">
          <span class="truncate">{i.name}</span>
          {i.isExternal ? <span class="ml-[6px] shrink-0 w-[40px] h-[20px] inline-flex items-center justify-center rounded-[2px] bg-[#fef5e8] text-[12px] text-[#191919]">{language.t("model.tag.external")}</span> : null}
        </div>
      )}
    </List>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type Dismiss = "escape" | "outside" | "select" | "manage" | "provider"

type RiskDialogComponent = Component<{ onCancel: () => void; onConfirm: () => void }>

function NetworkRiskDialog(props: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  Dialog?: RiskDialogComponent
}) {
  const Dialog = props.Dialog ?? StudioVideoRiskDialog
  return (
    <Show when={props.open}>
      <Portal>
        <Dialog onCancel={props.onCancel} onConfirm={props.onConfirm} />
      </Portal>
    </Show>
  )
}

export const MODEL_TRIGGER_BASE_CLASS =
  "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group"

export function ModelTriggerLabel(props: {
  model?: ModelState
  nameStyle?: string
}) {
  const model = props.model ?? useLocal().model
  const language = useLanguage()
  const current = () => model.current()
  return (
    <>
      <span class="truncate" style={props.nameStyle}>
        {current()?.name ?? "选择模型"}
      </span>
      {current()?.isExternal ? (
        <span class="ml-[2px] shrink-0 w-[40px] h-[20px] inline-flex items-center justify-center rounded-[2px] bg-[#fef5e8] text-[12px] text-[#191919]">
          {language.t("model.tag.external")}
        </span>
      ) : null}
      <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
    </>
  )
}

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  children?: JSX.Element
  triggerAs?: ValidComponent
  triggerProps?: ModelSelectorTriggerProps
  onClose?: (cause: "escape" | "select") => void
  riskDialog?: RiskDialogComponent
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: Dismiss | null
  }>({
    open: false,
    dismiss: null,
  })
  const [risk, setRisk] = createStore<RiskStore>({ open: false, pending: undefined })
  const dialog = useDialog()

  const close = (dismiss: Dismiss) => {
    setStore("dismiss", dismiss)
    setStore("open", false)
  }

  const handleManage = () => {
    close("manage")
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  const handleConnectProvider = () => {
    close("provider")
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }
  const language = useLanguage()
  const model = props.model ?? useLocal().model

  return (
    <>
      <Kobalte
        open={store.open}
        onOpenChange={(next) => {
          if (next) setStore("dismiss", null)
          setStore("open", next)
        }}
        modal={false}
        placement="top-start"
        gutter={14}
      >
        <Kobalte.Trigger as={props.triggerAs ?? "div"} {...props.triggerProps}>
          {props.children}
        </Kobalte.Trigger>
        <Kobalte.Portal>
          <Kobalte.Content
            class="min-w-[198px] flex flex-col pl-2 pt-2 pb-2 rounded-md bg-surface-raised-stronger-non-alpha z-50 outline-none overflow-hidden"
            style="box-shadow: 0 4px 12px rgba(0,0,0,0.16)"
            onEscapeKeyDown={(event) => {
              close("escape")
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerDownOutside={(event) => {
              if (risk.open) {
                event.preventDefault()
                return
              }
              close("outside")
            }}
            onFocusOutside={() => {
              if (risk.open) return
              close("outside")
            }}
            onCloseAutoFocus={(event) => {
              const dismiss = store.dismiss
              if (dismiss === "outside") event.preventDefault()
              if (dismiss === "escape" || dismiss === "select") {
                event.preventDefault()
                props.onClose?.(dismiss)
              }
              setStore("dismiss", null)
            }}
          >
            <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
            <ModelList
              provider={props.provider}
              model={props.model}
              onSelect={() => close("select")}
              onExternalRisk={(x) => {
                setRisk("pending", x)
                setRisk("open", true)
              }}
              search={false}
              groupHeader={() => null}
              class="p-[0px] [&_[data-slot=list-search-wrapper]]:!hidden [&_[data-slot=list-header]]:!hidden [&_[data-slot=list-scroll]]:gap-0 [&_[data-slot=list-scroll]]:max-h-[260px] [&_[data-slot=list-scroll]]:!mask-none [&_[data-slot=list-items]]:!pr-2 [&_[data-slot=list-item]]:!h-9 [&_[data-slot=list-item]]:!px-3 [&_[data-slot=list-item]]:!rounded-[6px] [&_[data-slot=list-item]]:!text-[14px] [&_[data-slot=list-item]]:!leading-[22px] [&_[data-slot=list-item]]:!text-[#191919] [&_[data-slot=list-item]>span]:!truncate [&_[data-slot=list-item]]:!mb-1 [&_[data-slot=list-group]:last-child]:!pb-0 [&_[data-slot=list-item-selected-icon]]:!hidden [&_[data-slot=list-item][data-active=true]]:!bg-transparent [&_[data-slot=list-item][data-active=true]:hover]:!bg-[rgba(0,0,0,0.1)] [&_[data-slot=list-item][data-selected=true]]:!bg-[rgba(0,0,0,0.05)] [&_[data-slot=list-item]:active]:!bg-[rgba(0,0,0,0.15)]"
              action={
                <div class="flex items-center gap-1">
                  <Tooltip placement="top" value={language.t("command.provider.connect")}>
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      iconSize="normal"
                      class="size-6"
                      aria-label={language.t("command.provider.connect")}
                      onClick={handleConnectProvider}
                    />
                  </Tooltip>
                  <Tooltip placement="top" value={language.t("dialog.model.manage")}>
                    <IconButton
                      icon="sliders"
                      variant="ghost"
                      iconSize="normal"
                      class="size-6"
                      aria-label={language.t("dialog.model.manage")}
                      onClick={handleManage}
                    />
                  </Tooltip>
                </div>
              }
            />
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
      <NetworkRiskDialog
        open={risk.open}
        Dialog={props.riskDialog}
        onCancel={() => {
          setRisk("open", false)
          setRisk("pending", undefined)
          close("select")
        }}
        onConfirm={() => {
          setRisk("open", false)
          const pending = risk.pending
          if (pending) {
            model.set({ modelID: pending.id, providerID: pending.provider.id }, { recent: true })
          }
          setRisk("pending", undefined)
          close("select")
        }}
      />
    </>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const model = props.model ?? useLocal().model
  const [risk, setRisk] = createStore<RiskStore>({ open: false, pending: undefined })

  const provider = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  const manage = () => {
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={provider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <ModelList
        provider={props.provider}
        model={props.model}
        onSelect={() => dialog.close()}
        onExternalRisk={(x) => {
          setRisk("pending", x)
          setRisk("open", true)
        }}
      />
      <Button variant="ghost" class="ml-3 mt-5 mb-6 text-text-base self-start" onClick={manage}>
        {language.t("dialog.model.manage")}
      </Button>
      <NetworkRiskDialog
        open={risk.open}
        onCancel={() => {
          setRisk("open", false)
          setRisk("pending", undefined)
          dialog.close()
        }}
        onConfirm={() => {
          setRisk("open", false)
          const pending = risk.pending
          if (pending) {
            model.set({ modelID: pending.id, providerID: pending.provider.id }, { recent: true })
          }
          setRisk("pending", undefined)
          dialog.close()
        }}
      />
    </Dialog>
  )
}
