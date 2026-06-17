import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ArtifactSnapshot } from "../../utils/snapshot-store"

export function VersionPanel(props: {
  snapshots: ArtifactSnapshot[]
  onRestore: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): JSX.Element {
  return (
    <div
      class="flex flex-col shrink-0 overflow-hidden"
      style={{
        width: "220px",
        "border-left": "1px solid var(--octo-border-divider)",
        background: "var(--octo-surface-page)",
      }}
    >
      <div
        class="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
      >
        <span class="text-xs font-medium" style={{ color: "var(--octo-text-strong)" }}>
          History
        </span>
        <button
          type="button"
          class="octo-action-btn"
          style={{ padding: "2px 4px" }}
          onClick={props.onClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0">
        <Show when={props.snapshots.length === 0}>
          <div class="px-3 py-4 text-center text-[11px]" style={{ color: "var(--octo-text-disabled)" }}>
            No snapshots yet
          </div>
        </Show>
        <For each={props.snapshots}>
          {(snapshot) => (
            <div
              class="px-3 py-2 group relative"
              style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
            >
              <div class="text-xs font-medium truncate" style={{ color: "var(--octo-text-primary)" }}>
                {snapshot.label || "Untitled"}
              </div>
              <div class="text-[10px] mt-0.5" style={{ color: "var(--octo-text-secondary)" }}>
                {formatTime(snapshot.timestamp)}
              </div>
              <div class="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
                <button
                  type="button"
                  class="octo-action-btn"
                  style={{ padding: "2px 4px", "font-size": "10px" }}
                  onClick={() => props.onRestore(snapshot.id)}
                  title="Restore"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M2 5h6M5 2l3 3-3 3" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="octo-action-btn"
                  style={{ padding: "2px 4px", "font-size": "10px" }}
                  onClick={() => props.onRemove(snapshot.id)}
                  title="Delete"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M2 2l6 6M8 2l-6 6" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`

  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}
