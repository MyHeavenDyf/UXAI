import { createSignal, Show, For, type JSX } from "solid-js"
import type { ComponentCatalog } from "../utils/a2ui-protocol"

export function ComponentCatalogPicker(props: {
  selected: ComponentCatalog
  onSelect: (catalog: ComponentCatalog) => void
}): JSX.Element {
  const [open, setOpen] = createSignal(false)

  const options: { value: ComponentCatalog; label: string; desc: string }[] = [
    { value: "desktop", label: "Desktop", desc: "43 组件" },
    { value: "mobile", label: "Mobile", desc: "12 组件" },
  ]

  const current = () => options.find((o) => o.value === props.selected) ?? options[0]

  return (
    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors"
        style={{
          background: "var(--octo-brand-a8)",
          color: "var(--octo-brand)",
          border: "1px solid var(--octo-brand-a20)",
        }}
        onClick={() => setOpen(!open())}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="3" width="10" height="6" rx="1" stroke="currentColor" stroke-width="1.2" />
          <path d="M4 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <span>{current().label}</span>
      </button>

      <Show when={open()}>
        <div
          class="absolute bottom-full left-0 mb-1 rounded-lg shadow-lg overflow-hidden z-50"
          style={{
            "min-width": "160px",
            background: "var(--octo-surface-page)",
            border: "1px solid var(--octo-border-default)",
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <For each={options}>
            {(opt) => (
              <button
                type="button"
                class="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  background: props.selected === opt.value ? "var(--octo-brand-a8)" : "transparent",
                  color: props.selected === opt.value ? "var(--octo-brand)" : "var(--octo-text-primary)",
                }}
                onClick={() => { props.onSelect(opt.value); setOpen(false) }}
              >
                <span class="font-medium">{opt.label}</span>
                <span class="ml-1 opacity-50">{opt.desc}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
