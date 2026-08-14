import { For, Show, createEffect, onCleanup, createMemo } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import type { VersionEntry } from "../../utils/history-store"

const POPOVER_WIDTH = 260
const POPOVER_MAX_HEIGHT = 320
const GAP = 20
const VIEWPORT_PADDING = 8

export function HistoryPanel(props: {
  anchorRect: { top: number; bottom: number; left: number; right: number }
  entries: VersionEntry[]
  currentId: string | null
  onSwitch: (entry: VersionEntry) => void
  onClose: () => void
  ignoreRef?: () => HTMLElement | undefined
}): JSX.Element {
  let panelRef: HTMLDivElement | undefined

  createEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef?.contains(target)) return
      if (props.ignoreRef?.()?.contains(target)) return
      props.onClose()
    }
    const onBlur = () => props.onClose()
    document.addEventListener("click", handler)
    window.addEventListener("blur", onBlur)
    onCleanup(() => {
      document.removeEventListener("click", handler)
      window.removeEventListener("blur", onBlur)
    })
  })

  const position = createMemo(() => {
    const { top: anchorTop, bottom: anchorBottom, left: anchorLeft } = props.anchorRect
    const vh = window.innerHeight
    const vw = window.innerWidth

    let top = anchorBottom + GAP
    let left = anchorLeft

    if (top + POPOVER_MAX_HEIGHT > vh - VIEWPORT_PADDING) {
      top = anchorTop - GAP - POPOVER_MAX_HEIGHT
      if (top < VIEWPORT_PADDING) {
        top = VIEWPORT_PADDING
      }
    }

    if (left + POPOVER_WIDTH > vw - VIEWPORT_PADDING) {
      left = vw - POPOVER_WIDTH - VIEWPORT_PADDING
    }
    if (left < VIEWPORT_PADDING) {
      left = VIEWPORT_PADDING
    }

    return { top, left }
  })

  return (
    <Portal mount={document.body}>
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: `${position().top}px`,
          left: `${position().left}px`,
          width: `${POPOVER_WIDTH}px`,
          "max-height": `${POPOVER_MAX_HEIGHT}px`,
          "overflow-y": "auto",
          "scrollbar-width": "thin",
          "scrollbar-color": "rgb(208, 213, 219) transparent",
          background: "white",
          "border-radius": "8px",
          "box-shadow": "rgba(0,0,0,0.08) 0px 10px 15px -3px, rgba(0,0,0,0.04) 0px 4px 6px -2px",
          padding: "4px 0px",
          "z-index": "99999",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Show when={props.entries.length === 0}>
          <div class="px-3 py-4 text-center text-[11px]" style={{ color: "#9ca3af" }}>
            暂无历史版本
          </div>
        </Show>
        <For each={props.entries}>
          {(entry) => {
            const isCurrent = () => entry.id === props.currentId
            const label = () => {
              switch (entry.actor) {
                case "init": return "原始版本"
                case "user": return "用户编辑"
                case "agent": return "模型编辑"
              }
            }
            return (
              <div
                style={{
                  height: "32px",
                  display: "flex",
                  "align-items": "center",
                  padding: "0 12px",
                  cursor: "pointer",
                }}
                classList={{ "bg-blue-50": isCurrent() }}
                onClick={() => props.onSwitch(entry)}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    "border-radius": "50%",
                    "margin-right": "8px",
                    "flex-shrink": "0",
                    background: isCurrent() ? "#3b82f6" : "transparent",
                    border: isCurrent() ? "none" : "1px solid #9ca3af",
                  }}
                />
                <span
                  style={{
                    "font-size": "11px",
                    color: "#9ca3af",
                    "min-width": "72px",
                    "flex-shrink": "0",
                  }}
                >
                  {formatTime(entry.timestamp)}
                </span>
                <span
                  style={{
                    "font-size": "12px",
                    color: "#111827",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    flex: "1",
                  }}
                >
                  {label()}
                </span>
              </div>
            )
          }}
        </For>
      </div>
    </Portal>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
