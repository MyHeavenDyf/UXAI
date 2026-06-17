import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { loadDesignSystemIndex, loadDesignSystemTokens, type DesignSystemEntry } from "../utils/design-system-loader"
import { getDesignSystemPreviewHtml } from "../utils/design-system-preview"

export function DesignSystemPicker(props: {
  selected: string | null
  onSelect: (id: string | null) => void
}): JSX.Element {
  const [entries, setEntries] = createSignal<DesignSystemEntry[]>([])
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [swatches, setSwatches] = createSignal<string[]>([])
  const [hoveredId, setHoveredId] = createSignal<string | null>(null)
  const [previewHtml, setPreviewHtml] = createSignal<string | null>(null)
  const [previewLoading, setPreviewLoading] = createSignal(false)

  const previewCache = new Map<string, string>()

  createEffect(() => {
    const id = props.selected
    if (!id) { setSwatches([]); return }
    loadDesignSystemTokens(id).then((tokens) => {
      setSwatches(extractSwatches(tokens))
    }).catch(() => setSwatches([]))
  })

  const previewTarget = createMemo(() => {
    if (!open()) return null
    return hoveredId() ?? props.selected
  })

  createEffect(() => {
    const target = previewTarget()
    if (!target) { setPreviewHtml(null); return }

    const cached = previewCache.get(target)
    if (cached) { setPreviewHtml(cached); return }

    setPreviewLoading(true)
    getDesignSystemPreviewHtml(target)
      .then((html) => {
        previewCache.set(target, html)
        setPreviewHtml(html)
      })
      .catch(() => setPreviewHtml(null))
      .finally(() => setPreviewLoading(false))
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
        data-picked={props.selected ? "true" : undefined}
      >
        <Show when={swatches().length > 0}>
          <span class="flex items-center gap-[2px]">
            <For each={swatches().slice(0, 3)}>
              {(color) => <span class="octo-ds-swatch" style={{ background: color }} />}
            </For>
          </span>
        </Show>
        <span class="truncate">{props.selected ? props.selected : "Design System"}</span>
        <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="p-2 rounded-md bg-surface-raised-stronger-non-alpha z-50 outline-none overflow-hidden"
          style={{
            width: "520px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.16)",
          }}
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
              class="w-full px-2 py-1 text-xs rounded-md border-0 outline-none"
              style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-primary)" }}
            />
          </div>
          <div class="flex" style={{ height: "280px" }}>
            <ScrollView class="w-48 flex-shrink-0" style={{ "border-right": "1px solid var(--octo-border-divider)", "max-height": "280px" }}>
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
            <div class="flex-1 min-w-0" style={{ background: "var(--octo-shell-bg)" }}>
              <Show
                when={previewTarget()}
                fallback={<div class="flex items-center justify-center h-full text-xs" style={{ color: "var(--octo-text-disabled)" }}>悬停查看预览</div>}
              >
                <Show
                  when={previewHtml()}
                  fallback={
                    <div class="flex items-center justify-center h-full text-xs" style={{ color: "var(--octo-text-disabled)" }}>
                      {previewLoading() ? "加载中..." : "无预览"}
                    </div>
                  }
                >
                  <iframe
                    srcdoc={previewHtml()!}
                    sandbox="allow-same-origin"
                    style={{
                      width: "100%",
                      height: "240px",
                      border: "none",
                      "border-radius": "var(--octo-radius-sm)",
                      background: "white",
                    }}
                  />
                </Show>
              </Show>
            </div>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
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
