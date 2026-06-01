import { createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { buildSrcdoc } from "../../utils/srcdoc-builder"

function extractHtmlContent(text: string): string {
  const re = /```html\s*\n([\s\S]*?)\n?```/i
  const m = text.match(re)
  if (m) return m[1].trim()
  if (/<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text)) return text.trim()
  return text.trim()
}

export function HtmlRenderer(props: {
  content: string
  mode: "preview" | "edit"
  onContentChange?: (content: string) => void
}): JSX.Element {
  const srcdoc = createMemo(() => buildSrcdoc(extractHtmlContent(props.content), { focusGuard: true }))

  return (
    <div class="h-full w-full overflow-hidden" style={{ background: "white" }}>
      {props.mode === "preview" ? (
        <iframe
          srcdoc={srcdoc()}
          sandbox="allow-scripts"
          class="w-full h-full border-0"
          style={{ "min-height": "200px" }}
        />
      ) : (
        <textarea
          value={extractHtmlContent(props.content)}
          onInput={(e) => props.onContentChange?.(e.currentTarget.value)}
          class="w-full h-full resize-none p-4 text-sm font-mono outline-none"
          style={{
            background: "rgba(243,244,246,1)",
            color: "var(--octo-text-primary)",
            "tab-size": 2,
          }}
          spellcheck={false}
        />
      )}
    </div>
  )
}
