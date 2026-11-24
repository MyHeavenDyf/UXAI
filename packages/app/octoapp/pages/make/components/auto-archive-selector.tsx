import { Popover as Kobalte } from "@kobalte/core/popover"
import { For, Show, createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { MODEL_TRIGGER_BASE_CLASS } from "@/components/dialog-select-model"
import { IconSizeCheckmark } from "../icons"

export type AutoArchiveValue = "on" | "off"

export const AUTO_ARCHIVE_ON = "开启自动同步云端"
export const AUTO_ARCHIVE_OFF = "关闭自动同步云端"

/**
 * 自动归档开关（输入框「设计系统选择」右侧）。
 *
 * 两项固定菜单，默认「关闭自动归档」——仅开启状态下生成的 html 产物会自动
 * 打包 ZIP 归档上传
 */
export function AutoArchiveSelector(props: {
  value: AutoArchiveValue
  onChange?: (value: AutoArchiveValue) => void
}) {
  const [open, setOpen] = createSignal(false)

  const items = (): Array<{ value: AutoArchiveValue; label: string }> => [
    { value: "on", label: AUTO_ARCHIVE_ON },
    { value: "off", label: AUTO_ARCHIVE_OFF },
  ]
  const selectedLabel = () => (props.value === "on" ? AUTO_ARCHIVE_ON : AUTO_ARCHIVE_OFF)

  return (
    <Kobalte open={open()} onOpenChange={setOpen} modal={false} placement="top-start" gutter={14}>
      <Kobalte.Trigger
        as="button"
        type="button"
        class={`${MODEL_TRIGGER_BASE_CLASS} overflow-hidden focus-visible:outline-none`}
        data-action="prompt-auto-archive"
        title={selectedLabel()}
      >
        <Icon name="cloud-upload" class="size-4 shrink-0" />
        <span class="truncate">{selectedLabel()}</span>
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
          <Kobalte.Title class="sr-only">自动同步云端</Kobalte.Title>
          <For each={items()}>
            {(item) => (
              <button
                type="button"
                class={`flex w-full items-center h-9 px-3 mb-1 rounded-[6px] text-left text-[14px] leading-[22px] transition-colors ${
                  props.value === item.value
                    ? "text-[#0A59F7]"
                    : "text-[#191919] hover:bg-[rgba(0,0,0,0.1)] active:bg-[rgba(0,0,0,0.15)]"
                }`}
                title={item.label}
                onClick={() => {
                  props.onChange?.(item.value)
                  setOpen(false)
                }}
              >
                <span class="truncate">{item.label}</span>
                <Show when={props.value === item.value}>
                  <IconSizeCheckmark size={14} class="ml-auto shrink-0" />
                </Show>
              </button>
            )}
          </For>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
