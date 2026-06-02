import { createMemo, createSignal, Show, Switch, Match } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { ResultTab } from "./tab-store"
import type { ViewportPreset, PaletteId } from "./html-renderer"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { HtmlRenderer } from "./html-renderer"
import { DeckRenderer } from "./deck-renderer"
import { SvgRenderer } from "./svg-renderer"
import { ReactComponentRenderer } from "./react-component-renderer"
import { DiagramRenderer } from "./diagram-renderer"
import { IllustrationResultEmpty } from "../../icons/illustrations"

function extractCodeBlock(text: string, lang: string): string {
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n?```", "i")
  const m = text.match(re)
  return m ? m[1].trim() : text.trim()
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
  onContentChange?: (id: string, content: string) => void
}): JSX.Element {
  const activeTab = createMemo(() =>
    props.tabs.find((t) => t.id === props.activeId) ?? null
  )

  const [htmlModes, setHtmlModes] = createSignal<Record<string, "preview" | "edit">>({})
  const [viewport, setViewport] = createSignal<ViewportPreset>("desktop")
  const [palette, setPalette] = createSignal<PaletteId | null>(null)
  const [inspecting, setInspecting] = createSignal(false)

  const getHtmlMode = (id: string) => htmlModes()[id] ?? "preview"

  const toggleHtmlMode = (id: string) => {
    const current = getHtmlMode(id)
    setHtmlModes((prev) => ({ ...prev, [id]: current === "preview" ? "edit" : "preview" }))
  }

  const canToggleMode = (tab: ResultTab) => tab.type === "html" || tab.type === "svg"

  return (
    <div
      class="flex flex-col flex-1 min-w-0 overflow-hidden"
      style={{ background: "var(--octo-surface-result)" }}
    >
      <Show when={props.tabs.length > 0} fallback={<ResultViewerEmpty />}>
        <TabBar
          tabs={props.tabs}
          activeId={props.activeId}
          onActivate={props.onActivate}
          onClose={props.onClose}
        />
        <Show when={activeTab()}>
          {(tab) => (
            <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
              <ActionBar
                tab={tab()}
                mode={canToggleMode(tab()) ? getHtmlMode(tab().id) : undefined}
                onModeChange={canToggleMode(tab()) ? () => toggleHtmlMode(tab().id) : undefined}
                viewport={viewport()}
                onViewportChange={setViewport}
                palette={palette()}
                onPaletteChange={setPalette}
                inspecting={inspecting()}
                onInspectToggle={() => setInspecting((v) => !v)}
              />
              <div class="flex-1 min-h-0 overflow-hidden">
                <Switch
                  fallback={
                    <div class="p-4 overflow-auto h-full">
                      <pre class="text-sm text-[var(--octo-text-primary)] whitespace-pre-wrap font-mono">{tab().content}</pre>
                    </div>
                  }
                >
                  <Match when={tab().type === "table"}>
                    <TableRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "markdown" || tab().type === "markdown-document"}>
                    <MarkdownRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "mindmap" || tab().type === "diagram"}>
                    <DiagramRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "json"}>
                    <JsonRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "html"}>
                    <HtmlRenderer
                      content={tab().content}
                      mode={getHtmlMode(tab().id)}
                      viewport={viewport()}
                      palette={palette()}
                      inspecting={inspecting()}
                      onContentChange={(content) => props.onContentChange?.(tab().id, content)}
                    />
                  </Match>
                  <Match when={tab().type === "deck"}>
                    <DeckRenderer content={tab().content} />
                  </Match>
                  <Match when={tab().type === "svg"}>
                    <SvgRenderer
                      content={tab().content}
                      mode={getHtmlMode(tab().id)}
                      onContentChange={(content) => props.onContentChange?.(tab().id, content)}
                    />
                  </Match>
                  <Match when={tab().type === "react-component"}>
                    <ReactComponentRenderer content={tab().content} title={tab().title} />
                  </Match>
                </Switch>
              </div>
            </div>
          )}
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
