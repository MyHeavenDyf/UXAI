import { createSignal, createMemo, createEffect, For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { loadDesignSystemIndex, type DesignSystemEntry } from "../../utils/design-system-loader"

export function DesignSystemPicker(props: {
  selected: string | null
  onSelect: (id: string | null) => void
}): JSX.Element {
  const [entries, setEntries] = createSignal<DesignSystemEntry[]>([])
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [dropdownPos, setDropdownPos] = createSignal({ top: 0, left: 0, width: 0 })

  let triggerRef: HTMLButtonElement | undefined

  function updatePosition() {
    if (!triggerRef) return
    const rect = triggerRef.getBoundingClientRect()
    setDropdownPos({
      top: rect.top - 4,
      left: rect.left,
      width: rect.width,
    })
  }

  createEffect(() => {
    if (!open()) return
    updatePosition()
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(".design-system-picker-root") && !target.closest(".design-system-picker-portal")) {
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
    try {
      const list = loadDesignSystemIndex()
      setEntries(list)
    } catch (err) {
      console.error("[DesignSystemPicker] failed to load index", err)
    }
  }

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    const list = entries()
    if (!q) return list
    return list.filter((e) => e.id.includes(q) || e.title.toLowerCase().includes(q))
  })

  return (
    <div class="relative design-system-picker-root">
      <button
        ref={triggerRef}
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors"
        style={{
          background: props.selected ? "var(--octo-brand-a8)" : "transparent",
          color: props.selected ? "var(--octo-brand)" : "var(--octo-text-secondary)",
          border: props.selected ? "1px solid var(--octo-brand-a20)" : "1px solid transparent",
        }}
        onClick={() => {
          if (!open()) loadIndex()
          setOpen(!open())
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2" />
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
        </svg>
        <span>{props.selected ? props.selected : "Design System"}</span>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            class="fixed rounded-lg shadow-lg overflow-hidden z-[9999] design-system-picker-portal"
            style={{
              top: `${dropdownPos().top}px`,
              left: `${dropdownPos().left}px`,
              width: "256px",
              "max-height": "240px",
              background: "var(--octo-surface-page)",
              border: "1px solid var(--octo-border-default)",
              transform: "translateY(-100%)",
            }}
          >
            <div class="p-2">
              <input
                type="text"
                placeholder="Search..."
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="w-full px-2 py-1 text-xs rounded border-0 outline-none"
                style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-primary)" }}
              />
            </div>
            <div class="max-h-48 overflow-y-auto">
              <button
                type="button"
                class="w-full text-left px-3 py-1.5 text-xs transition-colors"
                style={{
                  background: !props.selected ? "var(--octo-brand-a8)" : "transparent",
                  color: !props.selected ? "var(--octo-brand)" : "var(--octo-text-primary)",
                }}
                onClick={() => { props.onSelect(null); setOpen(false) }}
              >
                None
              </button>
              <For each={filtered()}>
                {(entry) => (
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[var(--octo-brand-a5)]"
                    style={{
                      background: props.selected === entry.id ? "var(--octo-brand-a8)" : "transparent",
                      color: props.selected === entry.id ? "var(--octo-brand)" : "var(--octo-text-primary)",
                    }}
                    onClick={() => { props.onSelect(entry.id); setOpen(false) }}
                  >
                    <span class="font-medium">{entry.title}</span>
                    <span class="ml-1 opacity-50">{entry.id}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
