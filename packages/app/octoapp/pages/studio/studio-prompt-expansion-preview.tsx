import { createEffect, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"

type PreviewPart = Extract<Part, { type: "text" | "reasoning" }>

// Match Insight's live Markdown pacing without depending on its message/session UI.
function PreviewStream(props: { part: PreviewPart }) {
  const target = () => props.part.text.trim()
  const [shown, setShown] = createStore({ text: target() })
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const advance = () => {
    timer = undefined
    const text = target()
    if (!text.startsWith(shown.text) || text.length <= shown.text.length) {
      setShown("text", text)
      return
    }
    const remaining = [...text.slice(shown.text.length)]
    const size = remaining.length <= 12 ? 2 : remaining.length <= 48 ? 4
      : remaining.length <= 96 ? 8 : Math.min(24, Math.ceil(remaining.length / 8))
    const snap = remaining.slice(size, size + 8).findIndex((char) => /[\s.,!?;:)\]]/.test(char))
    setShown("text", shown.text + remaining.slice(0, snap < 0 ? size : size + snap + 1).join(""))
    if (shown.text.length < text.length) timer = setTimeout(advance, 24)
  }
  createEffect(on(target, (text) => {
    if (!text.startsWith(shown.text) || text.length < shown.text.length) {
      clear()
      setShown("text", text)
      return
    }
    if (shown.text.length < text.length && timer === undefined) timer = setTimeout(advance, 24)
  }))
  onCleanup(clear)

  return (
    <div data-component={props.part.type === "reasoning" ? "reasoning-part" : "text-part"} data-streaming>
      <div data-slot={props.part.type === "text" ? "text-part-body" : undefined}>
        <Markdown text={shown.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")} cacheKey={props.part.id} streaming />
      </div>
    </div>
  )
}

export function StudioPromptExpansionPreview(props: { parts?: PreviewPart[]; status: string }) {
  return (
    <Show when={props.status === "running" && props.parts?.some((part) => part.text.trim())}>
      <div class="studio-prompt-expansion-preview" role="region" aria-label="提示词扩写过程" tabIndex={0}>
        <For each={props.parts?.filter((part) => part.text.trim())}>
          {(part) => <PreviewStream part={part} />}
        </For>
      </div>
    </Show>
  )
}
