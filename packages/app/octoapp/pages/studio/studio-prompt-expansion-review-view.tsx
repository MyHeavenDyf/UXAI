import { createEffect, For, onCleanup, Show } from "solid-js"
import type { StudioTurnData } from "./turns"

export function StudioPromptExpansionReviewView(props: {
  turn: StudioTurnData
  text: string
  editable: boolean
  busy: boolean
  canGenerate: boolean
  onInput: (text: string) => void
  onChoose: (choice: "confirmed" | "ignored") => void
}) {
  const element: { current?: HTMLTextAreaElement } = {}
  const resize = () => {
    if (!element.current) return
    element.current.style.height = "auto"
    element.current.style.height = `${element.current.scrollHeight}px`
  }
  createEffect(() => {
    if (!element.current) return
    if (element.current.value !== props.text) element.current.value = props.text
    resize()
  })
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize)
  onCleanup(() => observer?.disconnect())

  return (
    <div class="studio-prompt-expansion-review">
      <p class="studio-prompt-expansion-copy">
        已完成图文反推，以下是基于参考图生成的可执行Prompt，可直接编辑后确认使用：
      </p>
      <Show when={props.turn.recommendation?.tags?.length}>
        <div class="studio-prompt-expansion-tags">
          <For each={props.turn.recommendation?.tags}>
            {(tag) => <span title={tag}><span>{tag}</span></span>}
          </For>
        </div>
      </Show>
      <p class="studio-prompt-expansion-copy">
        已基于您选中的图片风格进行扩写，可直接编辑后确认使用：
      </p>
      <div class="studio-prompt-expansion-editor" ref={(node) => observer?.observe(node)}>
        <div class="studio-prompt-expansion-editor-title">扩写结果（可编辑）</div>
        <textarea
          ref={(node) => { element.current = node }}
          aria-label="扩写提示词"
          value={props.text}
          readOnly={!props.editable}
          onInput={(event) => {
            props.onInput(event.currentTarget.value)
            resize()
          }}
        />
      </div>
      <Show when={props.editable}>
        <div class="studio-prompt-expansion-actions">
          <button
            type="button"
            disabled={props.busy || !props.canGenerate || !props.text.trim()}
            onClick={() => props.onChoose("confirmed")}
          >
            确认，按扩写内容生成
          </button>
          <button
            type="button"
            disabled={props.busy || !props.canGenerate || !props.turn.userText.trim()}
            onClick={() => props.onChoose("ignored")}
          >
            忽略，使用原始描述
          </button>
        </div>
      </Show>
    </div>
  )
}
