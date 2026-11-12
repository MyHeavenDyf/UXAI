import { Popover as Kobalte } from "@kobalte/core/popover"
import { For, Show, createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { MODEL_TRIGGER_BASE_CLASS } from "@/components/dialog-select-model"
import { IconPaintPalette, IconSizeCheckmark } from "../icons"

export const DESIGN_SYSTEM_NONE = "不使用设计系统"

export function DesignSystemSelector(props: {
  options: string[]
  selected: string | null
  onSelect: (label: string | null) => void
}) {
  const [open, setOpen] = createSignal(false)

  const items = () => [null, ...props.options]

  return (
    <Kobalte open={open()} onOpenChange={setOpen} modal={false} placement="top-start" gutter={14}>
      <Kobalte.Trigger
        as="button"
        type="button"
        class={`${MODEL_TRIGGER_BASE_CLASS} overflow-hidden focus-visible:outline-none max-w-[180px]`}
        data-action="prompt-design-system"
        title={props.selected ?? DESIGN_SYSTEM_NONE}
      >
        <IconPaintPalette size={14} />
        <Show when={props.selected}>
          {(label) => <span class="truncate">{label()}</span>}
        </Show>
        <Icon
          name="chevron-down"
          class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180"
          style="color: #000"
        />
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="max-w-[320px] flex flex-col px-2 pt-2 pb-2 rounded-md bg-surface-raised-stronger-non-alpha z-50 outline-none overflow-hidden"
          style="box-shadow: 0 4px 12px rgba(0,0,0,0.16)"
        >
          <Kobalte.Title class="sr-only">选择设计系统</Kobalte.Title>
          <div class="max-h-[260px] overflow-y-auto">
            <For each={items()}>
              {(item) => (
                <button
                  type="button"
                  class={`flex w-full items-center h-9 px-3 mb-1 rounded-[6px] text-left text-[14px] leading-[22px] transition-colors ${
                    props.selected === item
                      ? "text-[#0A59F7]"
                      : "text-[#191919] hover:bg-[rgba(0,0,0,0.1)] active:bg-[rgba(0,0,0,0.15)]"
                  }`}
                  title={item ?? DESIGN_SYSTEM_NONE}
                  onClick={() => {
                    props.onSelect(item)
                    setOpen(false)
                  }}
                >
                  <span class="truncate">{item ?? DESIGN_SYSTEM_NONE}</span>
                  <Show when={props.selected === item}>
                    <IconSizeCheckmark size={14} class="ml-auto shrink-0" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
