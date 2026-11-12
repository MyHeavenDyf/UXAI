import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { PixsoAction } from "@/utils/useZipTransport"
import { IconCanvasEdit } from "../../../make/icons"
import { canvasDisabledReason } from "../../utils/canvas-edit"
import { createCanvasEditSession } from "../../utils/canvas-edit-session"
import { insightCanvasTransport } from "../../utils/canvas-transport"
import type { ResultTab, TabViewMode } from "./tab-store"

export function CanvasEditMenu(props: {
  tab: ResultTab
  mode: TabViewMode
  sessionId?: string
  directory: string
  revision?: number
  loadState?: "loading" | "error" | "ready"
  onFilesRefresh?: () => void | Promise<void>
}) {
  const [state, setState] = createStore({ busy: false, open: false, actions: [] as PixsoAction[] })
  let container: HTMLDivElement | undefined
  const key = () => JSON.stringify([props.sessionId, props.directory, props.tab.id, props.tab.source, props.tab.filePath, props.tab.uri, props.tab.content, props.mode, props.revision, props.loadState])
  const disabled = () => canvasDisabledReason(props.tab, props.mode, props.sessionId, insightCanvasTransport.available, props.loadState)
  const session = createCanvasEditSession({
    context: () => ({ key: key(), tab: props.tab, mode: props.mode, sessionId: props.sessionId, directory: props.directory, loggedIn: !!localStorage.getItem("uiplusToken"), transport: insightCanvasTransport, loadState: props.loadState }),
    changed: setState,
    notify: (title, error) => showToast({ title, variant: error ? "error" : "default" }),
    onFilesRefresh: (sessionId, directory) => {
      if (props.sessionId === sessionId && props.directory === directory) return props.onFilesRefresh?.()
    },
  })
  createEffect(() => { key(); session.reset() })
  createEffect(() => {
    if (!state.open) return
    const click = (event: MouseEvent) => { if (!container?.contains(event.target as Node)) session.close() }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") session.close() }
    document.addEventListener("click", click)
    window.addEventListener("keydown", escape)
    window.addEventListener("blur", session.close)
    onCleanup(() => {
      document.removeEventListener("click", click)
      window.removeEventListener("keydown", escape)
      window.removeEventListener("blur", session.close)
    })
  })
  onCleanup(session.reset)
  return (
    <Show when={props.tab.type === "html"}>
      <div ref={container} class="relative shrink-0">
        <Tooltip placement="top" value={disabled() || "画布编辑"}>
          <span class="inline-flex" title={disabled() || undefined}>
            <button
              type="button"
              class={props.tab.fromAttachment ? "octo-action-btn" : "flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors hover:bg-[var(--octo-surface-hover)]"}
              classList={{ "opacity-40 cursor-not-allowed": !!disabled() || state.busy }}
              style={{ color: "var(--octo-text-secondary)" }}
              disabled={!!disabled() || state.busy}
              aria-label="画布编辑"
              aria-haspopup="menu"
              aria-expanded={state.open}
              onClick={() => void session.prepare()}
            >
              <IconCanvasEdit size={props.tab.fromAttachment ? 16 : 14} />
              <span>{state.busy ? "加载中..." : "画布编辑"}</span>
            </button>
          </span>
        </Tooltip>
        <Show when={state.open}>
          <div role="menu" aria-label="画布操作" class="absolute right-0 top-full z-[60] mt-1 min-w-36 rounded-lg border p-1 shadow-lg" style={{ background: "var(--octo-surface-page)", "border-color": "var(--octo-border-divider)" }}>
            <For each={state.actions}>{action => (
              <button type="button" role="menuitem" class="block w-full whitespace-nowrap rounded px-3 py-2 text-left text-xs hover:bg-[var(--octo-surface-hover)]" onClick={() => void session.run(unwrap(action))}>{action.label}</button>
            )}</For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
