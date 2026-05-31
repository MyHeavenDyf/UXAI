import { createSignal, createMemo, createEffect, For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { loadTemplateIndex, loadTemplate, type TemplateEntry } from "../utils/template-loader"

export function TemplatePicker(props: {
  onSelect: (content: string) => void
}): JSX.Element {
  const [entries, setEntries] = createSignal<TemplateEntry[]>([])
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null)

  let triggerRef: HTMLButtonElement | undefined

  createEffect(() => {
    if (!open()) return
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(".template-picker-root") && !target.closest(".template-picker-portal")) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onClickOutside, true)
    }, 0)
    onCleanup(() => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", onClickOutside, true)
    })
  })

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

  function getDropdownPos() {
    if (!triggerRef) return { top: 0, left: 0 }
    const rect = triggerRef.getBoundingClientRect()
    return { top: rect.top - 4, left: rect.left }
  }

  async function handleSelect(entry: TemplateEntry) {
    const content = await loadTemplate(entry.id)
    if (content) {
      // Extract just the body content after frontmatter
      const bodyM = content.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/)
      const body = bodyM ? bodyM[1].trim() : content
      props.onSelect(body)
    }
    setOpen(false)
  }

  return (
    <div class="relative template-picker-root">
      <button
        ref={triggerRef}
        type="button"
        class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
        style={{
          background: "transparent",
          color: "var(--octo-text-secondary)",
          border: "1px solid transparent",
        }}
        onClick={() => {
          if (!open()) loadIndex()
          setOpen(!open())
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="7" y="1" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="1" y="7" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
          <rect x="7" y="7" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1" />
        </svg>
        <span>Template</span>
      </button>

      <Show when={open()}>
        <Portal>
          {(() => {
            const pos = getDropdownPos()
            return (
              <div
                class="fixed rounded-xl shadow-lg overflow-hidden z-[9999] template-picker-portal flex flex-col"
                style={{
                  top: `${pos.top}px`,
                  left: `${pos.left}px`,
                  width: "320px",
                  "max-height": "360px",
                  background: "var(--octo-surface-page)",
                  border: "1px solid var(--octo-border-default)",
                  transform: "translateY(-100%)",
                  animation: "octo-pop-in 160ms var(--octo-ease-out)",
                }}
              >
                <div class="p-2 shrink-0">
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
                <div class="flex-1 overflow-y-auto min-h-0">
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
                </div>
              </div>
            )
          })()}
        </Portal>
      </Show>
    </div>
  )
}
