import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { STUDIO_OUTPAINT_RATIOS } from "@opencode-ai/core/studio-outpaint"
import { tracker } from "@/utils/tracker"
import type { StudioAspectRatio, StudioImage } from "./types"
import { createStudioOutpaint, StudioOutpaintStage, type StudioOutpaintInput } from "./studio-outpaint-stage"

export function StudioOutpaintEditor(props: {
  image: StudioImage
  aspectRatio: StudioAspectRatio
  onAspectRatio: (value: StudioAspectRatio) => void
  onClose: () => void
  onDelete: () => void
  busy?: boolean
  onSubmit: (input: StudioOutpaintInput) => void
}): JSX.Element {
  const [state, setState] = createStore({ prompt: "" })
  const editor = createStudioOutpaint({
    source: () => props.image.remoteUrl ?? props.image.url,
    key: () => props.image.id,
    busy: () => !!props.busy,
  })
  return (
    <div class="studio-enlarging">
      <div class="studio-enlarging-header">
        <span class="studio-canvas-tab">
          <span class="studio-canvas-label-text">扩图</span>
          <span
            class="studio-canvas-tab-close"
            onClick={() => {
              tracker.interaction({ module: "studio", name: "outpaint-close" })
              props.onClose()
            }}
            aria-label="关闭扩图"
            title="关闭扩图"
          />
        </span>
      </div>
      <div class="studio-enlarging-body">
        <div class="studio-enlarging-hint">
          <img src="/studio/studio_help_tips.png" alt="" class="studio-enlarging-hint-icon" />
          <span>保留特征生成更大尺寸和内容</span>
        </div>
        <div class="studio-enlarging-canvas-wrap">
          <StudioOutpaintStage editor={editor} source={props.image.remoteUrl ?? props.image.url} />
        </div>
        <Show when={editor.state.error}>{(error) => <div role="alert">{error()}</div>}</Show>
        <div class="studio-enlarging-controls">
          <div class="studio-enlarging-ratios" aria-label="扩图比例">
            <For each={STUDIO_OUTPAINT_RATIOS}>
              {(item) => (
                <button
                  type="button"
                  disabled={props.busy || !editor.state.ready}
                  onClick={() => {
                    tracker.interaction({
                      module: "studio",
                      name: "outpaint-ratio",
                      extend: JSON.stringify({ ratio: item }),
                    })
                    editor.applyRatio(item)
                  }}
                  class="studio-enlarging-ratio"
                  classList={{ active: item === editor.state.ratio }}
                >
                  {item}
                </button>
              )}
            </For>
            <span class="studio-enlarging-distance">
              左 {editor.metrics().left} · 右 {editor.metrics().right} · 上 {editor.metrics().top} · 下{" "}
              {editor.metrics().bottom}
            </span>
          </div>
          <div class="studio-enlarging-prompt-row">
            <textarea
              class="studio-enlarging-prompt"
              maxlength="2000"
              disabled={props.busy}
              placeholder="描述希望扩展出的画面内容"
              value={state.prompt}
              onInput={(event) => setState("prompt", event.currentTarget.value)}
            />
            <button
              type="button"
              class="studio-editor-delete"
              onClick={() => {
                tracker.interaction({ module: "studio", name: "outpaint-delete" })
                props.onDelete()
              }}
            >
              删除
            </button>
            <button
              type="button"
              disabled={!editor.canSubmit()}
              onClick={() => {
                editor.finish()
                props.onSubmit(editor.input(state.prompt))
              }}
              class="studio-hd-create disabled:opacity-45"
            >
              一键生成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
