import { createMemo, createSignal, onMount } from "solid-js"
import type { JSX } from "solid-js"

const MERMAID_URL = "/runtime/mermaid.min.js"

function extractMermaidSource(text: string): string {
  const mermaidMatch = text.match(/```mermaid\s*\n([\s\S]*?)\n?```/i)
  if (mermaidMatch) return mermaidMatch[1].trim()
  return text.trim()
}

function buildMermaidSrcdoc(code: string): string {
  const escapedCode = code
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #fff;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mermaid {
        max-width: 100%;
      }
      .mermaid-error {
        padding: 16px;
        background: #fff1f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #991b1b;
        font-family: ui-monospace, monospace;
        font-size: 12px;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div class="mermaid">${escapedCode}</div>
    <script src="${MERMAID_URL}"></script>
    <script>
      (function(){
        if (!window.mermaid) {
          document.body.innerHTML = '<div class="mermaid-error">Mermaid library failed to load</div>';
          return;
        }
        mermaid.initialize({
          startOnLoad: true,
          theme: 'default',
          securityLevel: 'loose',
          flowchart: { useMaxWidth: true },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
        });
      })();
    </script>
  </body>
</html>`
}

export function DiagramRenderer(props: { content: string }): JSX.Element {
  const code = createMemo(() => extractMermaidSource(props.content))
  const srcdoc = createMemo(() => buildMermaidSrcdoc(code()))
  const [view, setView] = createSignal<"preview" | "source">("preview")

  return (
    <div class="flex flex-col h-full w-full overflow-hidden">
      <div class="flex items-center justify-end gap-2 px-3 py-1.5 flex-shrink-0" style={{ background: "var(--octo-surface-page)", "border-bottom": "1px solid var(--octo-border-default)" }}>
        <button
          type="button"
          onClick={() => setView("preview")}
          classList={{ "px-2 py-1 text-xs rounded": true }}
          style={{
            background: view() === "preview" ? "var(--octo-brand-a8)" : "transparent",
            color: view() === "preview" ? "var(--octo-brand)" : "var(--octo-text-secondary)",
          }}
        >
          预览
        </button>
        <button
          type="button"
          onClick={() => setView("source")}
          classList={{ "px-2 py-1 text-xs rounded": true }}
          style={{
            background: view() === "source" ? "var(--octo-brand-a8)" : "transparent",
            color: view() === "source" ? "var(--octo-brand)" : "var(--octo-text-secondary)",
          }}
        >
          源码
        </button>
      </div>
      <div class="flex-1 overflow-hidden" style={{ background: view() === "source" ? "rgba(243,244,246,1)" : "white" }}>
        {view() === "source" ? (
          <pre
            class="h-full overflow-auto p-4 text-sm font-mono whitespace-pre-wrap"
            style={{ color: "var(--octo-text-primary)" }}
          >
            {code()}
          </pre>
        ) : (
          <iframe
            srcdoc={srcdoc()}
            sandbox="allow-scripts"
            class="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  )
}