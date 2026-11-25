import { For, Show } from "solid-js"
import { STUDIO_OUTPAINT_RATIOS } from "@opencode-ai/core/studio-outpaint"
import type { StudioOutpaint } from "../studio-outpaint-stage"

export function StudioBoardOutpaint(props: {
  anchor: { left: number; top: number; width: number }
  editor: StudioOutpaint
  prompt: string
  hidden: boolean
  blocked: boolean
  preparing: boolean
  error: string
  onPrompt: (prompt: string) => void
  onCancel: () => void
  onGenerate: () => void
}) {
  return (
    <section
      class="studio-board-outpaint"
      aria-label="扩图选项"
      style={{
        left: `${props.anchor.left}px`,
        top: `${props.anchor.top}px`,
        width: `${props.anchor.width}px`,
        visibility: props.hidden ? "hidden" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div class="studio-board-outpaint-tools" role="group" aria-label="扩图比例">
        <For each={STUDIO_OUTPAINT_RATIOS}>
          {(ratio) => (
            <button
              type="button"
              aria-pressed={props.editor.state.ratio === ratio}
              disabled={props.blocked || !props.editor.state.ready}
              onClick={() => props.editor.applyRatio(ratio)}
            >
              <span class="studio-board-outpaint-ratio-icon" data-ratio={ratio} aria-hidden="true" />
              {ratio}
            </button>
          )}
        </For>
      </div>
      <div class="studio-board-outpaint-input">
        <input
          maxlength="2000"
          aria-label="扩图提示词"
          value={props.prompt}
          disabled={props.blocked}
          placeholder="描述希望扩展出的内容画面"
          onInput={(event) => props.onPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            if (!props.blocked && props.editor.canSubmit()) props.onGenerate()
          }}
        />
        <button type="button" disabled={props.blocked} onClick={props.onCancel}>
          取消
        </button>
        <button
          type="button"
          class="generate"
          disabled={props.blocked || !props.editor.canSubmit()}
          onClick={props.onGenerate}
        >
          {props.preparing ? "处理中…" : "生成"}
        </button>
      </div>
      <Show when={props.error || props.editor.state.error}>
        {(error) => (
          <div class="studio-board-inpaint-error" role="alert">
            {error()}
          </div>
        )}
      </Show>
    </section>
  )
}
