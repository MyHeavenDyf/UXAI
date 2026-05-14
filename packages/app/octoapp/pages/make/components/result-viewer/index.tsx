import { createMemo, createSignal, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { ResultTab } from "./tab-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { HtmlRenderer } from "./html-renderer"
import { IllustrationResultEmpty } from "../../icons/illustrations"

function extractCodeBlock(text: string, lang: string): string {
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n?```", "i")
  const m = text.match(re)
  return m ? m[1].trim() : text.trim()
}

function MermaidPlaceholder(props: { content: string }): JSX.Element {
  const code = createMemo(() => extractCodeBlock(props.content, "mermaid"))
  return (
    <div class="p-4 h-full overflow-auto flex flex-col gap-3">
      <div
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
        style={{
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.25)",
          color: "#92400e",
        }}
      >
        <span>⚠️</span>
        <span>Mermaid 图表渲染将在 Phase 2 实现，当前显示源码</span>
      </div>
      <pre
        class="flex-1 text-sm text-[var(--octo-text-primary)] p-4 rounded-lg overflow-auto"
        style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
      >
        {code()}
      </pre>
    </div>
  )
}

function JsonRenderer(props: { content: string }): JSX.Element {
  const code = createMemo(() => {
    const raw = extractCodeBlock(props.content, "json")
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  })
  return (
    <div class="p-4 h-full overflow-auto">
      <pre
        class="text-sm text-[var(--octo-text-primary)] p-4 rounded-lg overflow-auto"
        style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
      >
        {code()}
      </pre>
    </div>
  )
}

function MarkdownRenderer(props: { content: string }): JSX.Element {
  return (
    <div class="p-4 h-full overflow-auto prose prose-sm max-w-none">
      <Markdown text={props.content} />
    </div>
  )
}

export function ResultViewer(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
}): JSX.Element {
  const activeTab = createMemo(() =>
    props.tabs.find((t) => t.id === props.activeId) ?? null
  )

  const [htmlModes, setHtmlModes] = createSignal<Record<string, "preview" | "edit">>({})

  const getHtmlMode = (id: string) => htmlModes()[id] ?? "preview"

  const toggleHtmlMode = (id: string) => {
    const current = getHtmlMode(id)
    setHtmlModes((prev) => ({ ...prev, [id]: current === "preview" ? "edit" : "preview" }))
  }

  return (
    <div
      class="flex flex-col flex-1 min-w-0 overflow-hidden"
      style={{ background: "var(--octo-surface-result)" }}
    >
      {/* DEBUG: 始终可见的状态栏 */}
      <div style={{ background: "#ff9800", color: "white", padding: "4px 8px", "font-size": "11px", "font-family": "monospace", "flex-shrink": 0 }}>
        tabs={props.tabs.length} activeId={props.activeId ?? "null"} activeType={activeTab()?.type ?? "null"} activeContentLen={activeTab()?.content?.length ?? 0}
      </div>
      <Show when={props.tabs.length > 0} fallback={<ResultViewerEmpty />}>
        <TabBar
          tabs={props.tabs}
          activeId={props.activeId}
          onActivate={props.onActivate}
          onClose={props.onClose}
        />
        <Show when={activeTab()}>
          {(tab) => {
            const t = tab()
            const mode = t.type === "html" ? getHtmlMode(t.id) : undefined
            const onModeChange = t.type === "html" ? () => toggleHtmlMode(t.id) : undefined
            return (
              <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
                <ActionBar tab={t} mode={mode} onModeChange={onModeChange} />
                <div class="flex-1 overflow-hidden">
                  <Show when={t.type === "table"}>
                    <TableRenderer content={t.content} />
                  </Show>
                  <Show when={t.type === "markdown"}>
                    <MarkdownRenderer content={t.content} />
                  </Show>
                  <Show when={t.type === "mindmap"}>
                    <MermaidPlaceholder content={t.content} />
                  </Show>
                  <Show when={t.type === "json"}>
                    <JsonRenderer content={t.content} />
                  </Show>
                  <Show when={t.type === "html"}>
                    <HtmlRenderer content={t.content} mode={mode ?? "preview"} />
                  </Show>
                  <Show when={t.type !== "table" && t.type !== "markdown" && t.type !== "mindmap" && t.type !== "json" && t.type !== "html"}>
                    <div class="p-4 overflow-auto h-full">
                      <pre class="text-sm text-[var(--octo-text-primary)] whitespace-pre-wrap font-mono">{t.content}</pre>
                    </div>
                  </Show>
                </div>
              </div>
            )
          }}
        </Show>
      </Show>
    </div>
  )
}

function ResultViewerEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
      <IllustrationResultEmpty width={80} height={80} />
      <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>对话产出将在这里展示</div>
      <div class="text-[12px]" style={{ color: "var(--octo-text-disabled)" }}>点击左侧输出卡片即可打开</div>
    </div>
  )
}
