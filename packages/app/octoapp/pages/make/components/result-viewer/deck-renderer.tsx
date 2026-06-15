import { createMemo, createSignal, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { buildSrcdoc } from "../../utils/srcdoc-builder"

function extractHtmlContent(text: string): string {
  const re = /```html\s*\n([\s\S]*?)\n?```/i
  const m = text.match(re)
  if (m) return m[1].trim()
  if (/<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text)) return text.trim()
  return text.trim()
}

export function DeckRenderer(props: { content: string }): JSX.Element {
  const [slideInfo, setSlideInfo] = createSignal({ active: 0, count: 0 })

  const srcdoc = createMemo(() =>
    buildSrcdoc(extractHtmlContent(props.content), { deck: true })
  )

  const handleIframeMessage = (e: MessageEvent) => {
    if (e.data?.type === "od:slide-state") {
      setSlideInfo({ active: e.data.active, count: e.data.count })
    }
  }

  onCleanup(() => {
    window.removeEventListener("message", handleIframeMessage)
  })

  let iframeRef: HTMLIFrameElement | undefined

  const goTo = (action: string, index?: number) => {
    iframeRef?.contentWindow?.postMessage({ type: "od:slide", action, index }, "*")
  }

  return (
    <div class="flex flex-col h-full w-full overflow-hidden" style={{ background: "white" }}>
      <div class="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          srcdoc={srcdoc()}
          sandbox="allow-scripts"
          class="w-full h-full border-0"
          onLoad={() => {
            window.removeEventListener("message", handleIframeMessage)
            window.addEventListener("message", handleIframeMessage)
            iframeRef?.contentWindow?.postMessage({ type: "od:slide", action: "go", index: 0 }, "*")
          }}
        />
      </div>
      <div
        class="flex items-center justify-center gap-3 py-1.5 flex-shrink-0"
        style={{ background: "var(--octo-surface-page)", "border-top": "1px solid var(--octo-border-default)" }}
      >
        <button
          type="button"
          onClick={() => goTo("prev")}
          class="px-2 py-0.5 text-xs rounded"
          style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-secondary)" }}
        >
          &lt;
        </button>
        <span class="text-xs" style={{ color: "var(--octo-text-secondary)" }}>
          {slideInfo().active + 1} / {slideInfo().count || "?"}
        </span>
        <button
          type="button"
          onClick={() => goTo("next")}
          class="px-2 py-0.5 text-xs rounded"
          style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-secondary)" }}
        >
          &gt;
        </button>
      </div>
    </div>
  )
}
