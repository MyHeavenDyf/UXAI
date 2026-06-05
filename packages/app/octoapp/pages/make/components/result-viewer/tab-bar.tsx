import { For } from "solid-js"
import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"
import { IconTabClose } from "../../icons"

export function TabBar(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
}): JSX.Element {
  return (
    <div
      class="flex items-center overflow-x-auto shrink-0 gap-2 px-6 py-3"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        "scrollbar-width": "none",
        background: "var(--octo-surface-page)",
      }}
    >
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
    </div>
  )
}
