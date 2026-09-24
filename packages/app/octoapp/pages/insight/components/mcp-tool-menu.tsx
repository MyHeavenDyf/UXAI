import { createEffect, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { PRESET_PROMPTS } from "../store/preset-prompts"
import type { McpSelection } from "../store/mcp-trigger"

export function McpToolMenu(props: {
  active: boolean
  onToggle: () => void
  selection: McpSelection | null
  onSelect: (selection: McpSelection) => void
  onClear: () => void
  onOpen: () => void
}) {
  let trigger: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined
  const [position, setPosition] = createStore({ left: 0, top: 0, width: 240 })
  createEffect(() => {
    if (!props.active) return
    props.onOpen()
    const rect = trigger?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(240, window.innerWidth - 24)
    const height = panel?.offsetHeight ?? 250
    setPosition({
      width,
      left: Math.max(12, rect.right + width + 12 <= window.innerWidth ? rect.right + 8 : rect.left - width - 8),
      top: Math.max(12, Math.min(rect.top, window.innerHeight - height - 12)),
    })
  })
  return <>
    <button ref={trigger} type="button" class="addon-menu-item" classList={{ "addon-menu-item--active": props.active }}
      aria-expanded={props.active} aria-haspopup="menu" onClick={props.onToggle}>
      <span class="addon-menu-item-icon"><Icon name="plus" size="small" /></span>
      <span class="addon-menu-item-text">研究工具</span>
      <Show when={props.selection}><span aria-label="已启用">●</span></Show>
      <Icon name="chevron-right" size="small" />
    </button>
    <Show when={props.active}>
      <div ref={panel} class="insight-addon-mcp-panel" role="menu" aria-label="研究工具"
        style={{ position: "fixed", left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }}>
        <For each={PRESET_PROMPTS}>{preset =>
          <button type="button" class="addon-menu-item" role="menuitemradio"
            aria-checked={props.selection?.preset.id === preset.id} title={preset.text}
            onClick={() => props.onSelect({ preset })}>
            <span class="addon-menu-item-text">{preset.label}</span>
            <Show when={props.selection?.preset.id === preset.id}><span>✓</span></Show>
          </button>
        }</For>
        <Show when={props.selection}>
          <button type="button" class="addon-menu-item" role="menuitem" onClick={props.onClear}>退出研究工具模式</button>
        </Show>
      </div>
    </Show>
  </>
}

export function McpModeBadge(props: { selection: McpSelection | null; onClear: () => void }) {
  return <Show when={props.selection}>{selection =>
    <div class="insight-addon-mode">
      <span>研究工具：{selection().preset.label}</span>
      <button type="button" aria-label="退出研究工具模式" onClick={props.onClear}>×</button>
    </div>
  }</Show>
}
