import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"
import { IconTabClose } from "../../icons"
import { IconFolder } from "../../icons/design-files-icons"

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
          onClick={() => props.onViewModeChange?.("files")}
          class="flex items-center transition-colors font-medium"
          style={{
            padding: "0px 16px",
            "border-radius": "999px",
            "font-size": "14px",
            "line-height": "22px",
            gap: "4px",
            height: "32px",
            color: props.viewMode === "files" ? "#0a59f7" : "#666",
            background: props.viewMode === "files" ? "rgba(10, 89, 247, 0.08)" : "rgba(0, 0, 0, 0.05)",
          }}
        >
          <IconFolder
            size={16}
            style={{ color: props.viewMode === "files" ? "#0a59f7" : "#666" }}
          />
          <span>文件管理</span>
        </button>

        <Show when={props.tabs.length > 0}>
          <div class="w-px h-4 shrink-0" style={{ background: "var(--octo-border-divider)" }} />
        </Show>
      </Show>

      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.id === props.activeId && props.viewMode === "tabs"
          return (
            <div
              class="octo-tab"
              data-active={isActive() ? "true" : undefined}
              onClick={() => {
                props.onActivate(tab.id)
                props.onViewModeChange?.("tabs")
              }}
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
    </div>
  )
}
