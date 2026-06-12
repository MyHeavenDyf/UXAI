import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"
import { IconTabClose } from "../../icons"
import { Icon } from "@opencode-ai/ui/icon"

export function TabBar(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  viewMode?: "tabs" | "files"
  onViewModeChange?: (mode: "tabs" | "files") => void
}): JSX.Element {
  return (
    <div
      class="flex items-center overflow-x-auto shrink-0 gap-2 px-6 py-3"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        "scrollbar-width": "none",
        height: "56px",
        background: "var(--octo-surface-page)",
      }}
    >
      <Show when={props.onViewModeChange}>
        <button
          type="button"
          onClick={() => props.onViewModeChange?.(props.viewMode === "files" ? "tabs" : "files")}
          classList={{
            "flex items-center gap-1 px-2 py-1 rounded transition-colors text-[12px]": true,
            "bg-surface-base-interactive-active text-text-interactive-base": props.viewMode === "files",
            "hover:bg-surface-base-hover": props.viewMode !== "files",
          }}
          style={{ color: props.viewMode === "files" ? undefined : "var(--octo-text-secondary)" }}
        >
          <Icon name="folder" size="small" />
          <span class="font-medium">Files</span>
        </button>
      </Show>

      <Show when={props.viewMode === "tabs"}>
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.id === props.activeId
            return (
              <div
                class="octo-tab"
                data-active={isActive() ? "true" : undefined}
                onClick={() => props.onActivate(tab.id)}
              >
                <span class="truncate min-w-0 text-left outline-none">{tab.title}</span>
                <button
                  type="button"
                  class="octo-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onClose(tab.id)
                  }}
                >
                  <IconTabClose size={16} />
                </button>
              </div>
            )
          }}
        </For>
      </Show>

      <Show when={props.viewMode === "files"}>
        <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>
          Design Files View
        </div>
      </Show>
    </div>
  )
}
