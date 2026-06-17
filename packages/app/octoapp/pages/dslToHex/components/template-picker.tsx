import { createSignal, createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { loadTemplateIndex, loadTemplate, type TemplateEntry } from "../utils/template-loader"

export function TemplatePicker(props: {
  onSelect: (content: string) => void
}): JSX.Element {
  const [entries, setEntries] = createSignal<TemplateEntry[]>([])
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null)

  const loadIndex = async () => {
    if (entries().length > 0) return
    setEntries(loadTemplateIndex())
  }

  const categories = createMemo(() => {
    const cats = new Set<string>()
    for (const e of entries()) cats.add(e.category)
    return [...cats].sort()
  })

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    const cat = activeCategory()
    return entries().filter((e) => {
      if (cat && e.category !== cat) return false
      if (!q) return true
      return e.id.includes(q) || e.title.toLowerCase().includes(q) || e.mode.includes(q)
    })
  })

  async function handleSelect(entry: TemplateEntry) {
    const content = await loadTemplate(entry.id)
    if (content) {
      const bodyM = content.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/)
      const body = bodyM ? bodyM[1].trim() : content
      props.onSelect(body)
    }
    setOpen(false)
  }

  return (
    <Kobalte
      open={open()}
      onOpenChange={(next) => {
        if (next) loadIndex()
        setOpen(next)
      }}
      placement="top-start"
      gutter={14}
    >
      <Kobalte.Trigger
        as="button"
        type="button"
        class="flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium overflow-hidden group focus-visible:outline-none"
      >
        <span class="truncate">Template</span>
        <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="p-2 flex flex-col rounded-md bg-surface-raised-stronger-non-alpha z-50 outline-none overflow-hidden"
          style={{
            width: "320px",
            height: "360px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.16)",
          }}
          onPointerDownOutside={() => setOpen(false)}
          onFocusOutside={() => setOpen(false)}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div class="shrink-0">
            <input
              type="text"
              placeholder="Search templates..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="w-full px-2 py-1 text-xs rounded-md border-0 outline-none"
              style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-primary)" }}
            />
          </div>
          <Show when={categories().length > 1}>
            <div class="flex gap-1 px-2 pb-1 shrink-0 overflow-x-auto" style={{ "scrollbar-width": "none" }}>
              <button
                type="button"
                class="px-2 py-0.5 text-[10px] rounded-full shrink-0 transition-colors"
                style={{
                  background: !activeCategory() ? "var(--octo-brand-a8)" : "transparent",
                  color: !activeCategory() ? "var(--octo-brand)" : "var(--octo-text-secondary)",
                }}
                onClick={() => setActiveCategory(null)}
              >
                All
              </button>
              <For each={categories()}>
                {(cat) => (
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[10px] rounded-full shrink-0 transition-colors"
                    style={{
                      background: activeCategory() === cat ? "var(--octo-brand-a8)" : "transparent",
                      color: activeCategory() === cat ? "var(--octo-brand)" : "var(--octo-text-secondary)",
                    }}
                    onClick={() => setActiveCategory(activeCategory() === cat ? null : cat)}
                  >
                    {cat}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <ScrollView class="flex-1 min-h-0">
            <For each={filtered()}>
              {(entry) => (
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 text-xs transition-colors"
                  style={{ color: "var(--octo-text-primary)" }}
                  onClick={() => void handleSelect(entry)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--octo-brand-a5)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                >
                  <div class="flex items-center gap-2">
                    <span class="font-medium truncate">{entry.title}</span>
                    <span
                      class="shrink-0 px-1.5 py-0.5 text-[10px] rounded-full"
                      style={{ background: "var(--octo-brand-a8)", color: "var(--octo-brand)" }}
                    >
                      {entry.mode}
                    </span>
                  </div>
                  <div class="text-[11px] mt-0.5" style={{ color: "var(--octo-text-secondary)" }}>
                    {entry.category}
                  </div>
                </button>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <div class="px-3 py-4 text-center text-xs" style={{ color: "var(--octo-text-disabled)" }}>
                No templates found
              </div>
            </Show>
          </ScrollView>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
