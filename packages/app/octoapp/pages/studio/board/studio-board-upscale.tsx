import { For } from "solid-js"
import { STUDIO_HD_MODES, type StudioHDMode } from "../studio-shared"

export function StudioBoardUpscale(props: {
  anchor: { left: number; top: number; width: number }
  mode: StudioHDMode
  hidden: boolean
  blocked: boolean
  preparing: boolean
  onMode: (mode: StudioHDMode) => void
  onGenerate: () => void
}) {
  return (
    <div
      class="studio-board-upscale"
      role="region"
      aria-label="变清晰选项"
      style={{
        left: `${props.anchor.left + props.anchor.width / 2}px`,
        top: `${props.anchor.top}px`,
        visibility: props.hidden ? "hidden" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div class="studio-board-upscale-options" role="radiogroup" aria-label="清晰度">
        <For each={STUDIO_HD_MODES}>
          {(option) => (
            <label class="studio-board-upscale-option">
              <input
                type="radio"
                name="studio-board-upscale-mode"
                value={option.value}
                checked={props.mode === option.value}
                disabled={props.blocked}
                onChange={() => props.onMode(option.value)}
              />
              <span>{option.label.replace("2k", "2K").replace(/^(8k|4k|2K)/, "$1 ")}</span>
            </label>
          )}
        </For>
      </div>
      <span class="studio-board-image-action-divider" aria-hidden="true" />
      <button type="button" class="studio-board-upscale-generate" disabled={props.blocked} onClick={props.onGenerate}>
        {props.preparing ? "处理中…" : "生成"}
      </button>
    </div>
  )
}
