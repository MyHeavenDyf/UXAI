import { createMemo } from "solid-js"
import type { JSX } from "solid-js"

function extractSvgContent(text: string): string {
  const re = /```(?:xml|svg)?\s*\n([\s\S]*?)\n?```/i
  const m = text.match(re)
  if (m) return m[1].trim()
  if (/^<svg[\s>]/i.test(text.trim())) return text.trim()
  return text.trim()
}

export function SvgRenderer(props: {
  content: string
  mode?: "preview" | "edit"
  onContentChange?: (content: string) => void
}): JSX.Element {
  const svg = createMemo(() => extractSvgContent(props.content))

  const srcdoc = createMemo(() => {
    const s = svg()
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 16px; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: white; }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>${s}</body>
</html>`
  })

  return (
    <div class="flex flex-col h-full w-full overflow-hidden">
      <div class="flex-1 overflow-hidden" style={{ background: props.mode === "edit" ? "rgba(243,244,246,1)" : "white" }}>
        {props.mode === "edit" ? (
          <textarea
            value={svg()}
            onInput={(e) => props.onContentChange?.(e.currentTarget.value)}
            class="w-full h-full overflow-auto text-sm font-mono whitespace-pre-wrap p-4 resize-none border-0 outline-none"
            style={{ color: "var(--octo-text-primary)", background: "rgba(243,244,246,1)" }}
          />
        ) : (
          <iframe
            srcdoc={srcdoc()}
            sandbox=""
            class="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  )
}
