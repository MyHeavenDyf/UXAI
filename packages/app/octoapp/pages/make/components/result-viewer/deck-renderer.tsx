import { createMemo, onCleanup } from "solid-js"
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
  const srcdoc = createMemo(() =>
    buildSrcdoc(extractHtmlContent(props.content), { deck: true })
  )

  return (
    <div class="flex flex-col h-full w-full overflow-hidden" style={{ background: "white" }}>
      <div class="flex-1 overflow-hidden">
        <iframe
          srcdoc={srcdoc()}
          sandbox="allow-scripts"
          class="w-full h-full border-0"
        />
      </div>
    </div>
  )
}
