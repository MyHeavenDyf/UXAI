import { createSignal, createMemo, For } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import "../../assets/style/chat/design_system_picker.css"

type DesignSystemEntry = {
  id: string
  title: string
}

export function DesignSystemPicker(props: {
  selected: string | null
  onSelect: (id: string | null) => void
}): JSX.Element {
  const entries: DesignSystemEntry[] = [{ id: "ICT-3.1", title: "ICT-3.1" }]
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [hoveredId, setHoveredId] = createSignal<string | null>(null)

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.id.includes(q) || e.title.toLowerCase().includes(q))
  })

  return (
    <Kobalte
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
      }}
      placement="top-start"
      gutter={14}
    >
      <Kobalte.Trigger
        as="button"
        type="button"
        class="flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium overflow-hidden group focus-visible:outline-none"
        data-picked={props.selected ? "true" : undefined}
      >
        <span class="truncate">{props.selected ? props.selected : "Design System"}</span>
        <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180 chevron-down-icon" />
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="p-2 rounded-md bg-surface-raised-stronger-non-alpha z-50 outline-none overflow-hidden"
          style={{"box-shadow": "0 4px 12px rgba(0,0,0,0.16)"}}
          onPointerDownOutside={() => setOpen(false)}
          onFocusOutside={() => setOpen(false)}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div>
            <input
              type="text"
              placeholder="Search..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="w-full px-2 py-1 text-xs rounded-md border-0 outline-none picker-search"
            />
          </div>
          <div class="flex view-contain">
            <ScrollView class="w-48 flex-shrink-0 view-content">
              <button
                type="button"
                class="w-full text-left px-3 py-1.5 text-xs transition-colors"
                style={{
                  background: !props.selected ? "var(--octo-brand-a8)" : "transparent",
                  color: !props.selected ? "var(--octo-brand)" : "var(--octo-text-primary)",
                }}
                onClick={() => { props.onSelect(null); setOpen(false) }}
                onMouseEnter={() => setHoveredId(null)}
              >
                None
              </button>
              <For each={filtered()}>
                {(entry) => (
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-xs transition-colors"
                    style={{
                      background: props.selected === entry.id ? "var(--octo-brand-a8)" : hoveredId() === entry.id ? "var(--octo-surface-hover)" : "transparent",
                      color: props.selected === entry.id ? "var(--octo-brand)" : "var(--octo-text-primary)",
                    }}
                    onClick={() => { props.onSelect(entry.id); setOpen(false) }}
                    onMouseEnter={() => setHoveredId(entry.id)}
                  >
                    <span class="font-medium truncate block">{entry.title}</span>
                  </button>
                )}
              </For>
            </ScrollView>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
