import { createSignal, createEffect, Show, onCleanup } from "solid-js"
import type { JSX } from "solid-js"

export type InspectTarget = {
  tag: string
  selector: string
  text: string
  position: { x: number; y: number; width: number; height: number }
  style: Record<string, string>
  htmlHint: string
}

export function PreviewOverlay(props: {
  iframeRef: HTMLIFrameElement | undefined
  inspecting: boolean
}): JSX.Element {
  const [target, setTarget] = createSignal<InspectTarget | null>(null)

  function onMessage(e: MessageEvent) {
    const d = e.data
    if (!d) return
    if (d.type === "od:inspect-target") {
      setTarget({
        tag: d.tag ?? "",
        selector: d.selector ?? "",
        text: d.text ?? "",
        position: d.position ?? { x: 0, y: 0, width: 0, height: 0 },
        style: d.style ?? {},
        htmlHint: d.htmlHint ?? "",
      })
    }
    if (d.type === "od:inspect-leave") {
      setTarget(null)
    }
  }

  function sendInspectMode(enabled: boolean) {
    const iframe = props.iframeRef
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage({ type: "od:inspect-mode", enabled }, "*")
  }

  function activateWhenReady(enabled: boolean) {
    const iframe = props.iframeRef
    if (!iframe?.contentWindow) return

    // Try sending immediately (iframe usually already loaded with srcdoc)
    sendInspectMode(enabled)

    // Also retry after a short delay in case the bridge script hasn't initialized
    const timer = setTimeout(() => sendInspectMode(enabled), 300)
    onCleanup(() => clearTimeout(timer))
  }

  createEffect(() => {
    if (props.inspecting) {
      window.addEventListener("message", onMessage)
      activateWhenReady(true)
    } else {
      sendInspectMode(false)
      window.removeEventListener("message", onMessage)
      setTarget(null)
    }
  })

  onCleanup(() => {
    window.removeEventListener("message", onMessage)
    sendInspectMode(false)
  })

  return (
    <Show when={props.inspecting && target()}>
      {(t) => (
        <div
          class="octo-inspect-panel"
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            width: "260px",
            "max-height": "200px",
            overflow: "auto",
            background: "var(--octo-surface-page)",
            border: "1px solid var(--octo-border-default)",
            "border-radius": "var(--octo-radius-lg)",
            "box-shadow": "var(--octo-shadow-md)",
            padding: "10px",
            "z-index": "100",
            "font-size": "11px",
            "pointer-events": "none",
          }}
        >
          <div style={{ "font-weight": 600, color: "var(--octo-brand)", "margin-bottom": "6px" }}>
            {t().tag}
          </div>
          <div style={{ color: "var(--octo-text-secondary)", "margin-bottom": "6px", "word-break": "break-all" }}>
            {t().selector}
          </div>
          <Show when={t().text}>
            <div
              style={{
                color: "var(--octo-text-tertiary)",
                "white-space": "nowrap",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "margin-bottom": "6px",
              }}
            >
              {t().text}
            </div>
          </Show>
          <div style={{ "border-top": "1px solid var(--octo-border-divider)", "padding-top": "6px" }}>
            <Show when={t().style.color}>
              <div style={{ display: "flex", gap: "4px", "align-items": "center", "margin-bottom": "2px" }}>
                <span style={{ width: "10px", height: "10px", "border-radius": "2px", background: t().style.color, border: "1px solid rgba(0,0,0,0.1)", flex: "0 0 auto" }} />
                <span style={{ color: "var(--octo-text-secondary)" }}>color: {t().style.color}</span>
              </div>
            </Show>
            <Show when={t().style.backgroundColor && t().style.backgroundColor !== "rgba(0, 0, 0, 0)"}>
              <div style={{ display: "flex", gap: "4px", "align-items": "center", "margin-bottom": "2px" }}>
                <span style={{ width: "10px", height: "10px", "border-radius": "2px", background: t().style.backgroundColor, border: "1px solid rgba(0,0,0,0.1)", flex: "0 0 auto" }} />
                <span style={{ color: "var(--octo-text-secondary)" }}>bg: {t().style.backgroundColor}</span>
              </div>
            </Show>
            <Show when={t().style.fontSize}>
              <div style={{ color: "var(--octo-text-secondary)" }}>
                font: {t().style.fontSize} {t().style.fontWeight}
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}
