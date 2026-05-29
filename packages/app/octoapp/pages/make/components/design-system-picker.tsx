import { createSignal, createMemo, createEffect, For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { loadDesignSystemIndex, loadDesignSystemTokens, type DesignSystemEntry } from "../utils/design-system-loader"

export function DesignSystemPicker(props: {
  selected: string | null
  onSelect: (id: string | null) => void
}): JSX.Element {
  const [entries, setEntries] = createSignal<DesignSystemEntry[]>([])
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [swatches, setSwatches] = createSignal<string[]>([])

  let triggerRef: HTMLButtonElement | undefined

  createEffect(() => {
    const id = props.selected
    if (!id) { setSwatches([]); return }
    loadDesignSystemTokens(id).then((tokens) => {
      setSwatches(extractSwatches(tokens))
    }).catch(() => setSwatches([]))
  })

  function getDropdownPos() {
    if (!triggerRef) return { top: 0, left: 0 }
    const rect = triggerRef.getBoundingClientRect()
    return { top: rect.top - 4, left: rect.left }
  }

  createEffect(() => {
    if (!open()) return
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
        class="octo-ds-trigger"
        data-picked={props.selected ? "true" : undefined}
        onClick={() => {
          if (!open()) loadIndex()
          setOpen(!open())
        }}
      >
        <Show when={swatches().length > 0}>
          <span class="flex items-center gap-[2px]">
            <For each={swatches().slice(0, 3)}>
              {(color) => <span class="octo-ds-swatch" style={{ background: color }} />}
            </For>
          </span>
        </Show>
        <span class="truncate">{props.selected ? props.selected : "Design System"}</span>
      </button>

      <Show when={open()}>
        <Portal>
          {(() => {
            const pos = getDropdownPos()
            return (
              <div
                class="fixed rounded-xl shadow-lg overflow-hidden z-[9999] design-system-picker-portal"
                style={{
                  top: `${pos.top}px`,
                  left: `${pos.left}px`,
                  width: "256px",
                  "max-height": "240px",
                  background: "var(--octo-surface-page)",
                  border: "1px solid var(--octo-border-default)",
                  transform: "translateY(-100%)",
                  animation: "octo-pop-in 160ms var(--octo-ease-out)",
                }}
              >
                <div class="p-2">
                  <input
                    type="text"
                    placeholder="Search..."
                    value={search()}
                    onInput={(e) => setSearch(e.currentTarget.value)}
                    class="w-full px-2 py-1 text-xs rounded-md border-0 outline-none"
                    style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-primary)" }}
                  />
                </div>
                <div class="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-xs transition-colors rounded-md"
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
                        class="w-full text-left px-3 py-1.5 text-xs transition-colors rounded-md"
                        style={{
                          background: props.selected === entry.id ? "var(--octo-brand-a8)" : "transparent",
                          color: props.selected === entry.id ? "var(--octo-brand)" : "var(--octo-text-primary)",
                        }}
                        onClick={() => { props.onSelect(entry.id); setOpen(false) }}
                        onMouseEnter={(e) => {
                          if (props.selected !== entry.id) e.currentTarget.style.background = "var(--octo-brand-a5)"
                        }}
                        onMouseLeave={(e) => {
                          if (props.selected !== entry.id) e.currentTarget.style.background = "transparent"
                        }}
                      >
                        <span class="font-medium">{entry.title}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )
          })()}
        </Portal>
      </Show>
    </div>
  )
}

function extractSwatches(tokensCss: string): string[] {
  const colors: string[] = []
  const patterns = [
    /--accent\s*:\s*([^;]+)/,
    /--bg\s*:\s*([^;]+)/,
    /--fg\s*:\s*([^;]+)/,
  ]
  for (const p of patterns) {
    const m = tokensCss.match(p)
    if (m) colors.push(m[1].trim())
  }
  return colors
}
