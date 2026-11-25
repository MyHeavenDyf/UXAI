import { For, Show } from "solid-js"
import type { StudioInpaintMode } from "../studio-shared"
import type { StudioInpaintDrawing } from "../studio-inpaint-canvas"

export function StudioBoardInpaint(props: {
  anchor: { left: number; top: number; width: number }
  drawing: StudioInpaintDrawing
  mode: StudioInpaintMode
  brushSize: number
  prompt: string
  hidden: boolean
  blocked: boolean
  preparing: boolean
  error: string
  onMode: (mode: StudioInpaintMode) => void
  onBrush: (size: number) => void
  onPrompt: (prompt: string) => void
  onCancel: () => void
  onGenerate: () => void
}) {
  const canGenerate = () => !props.blocked && props.drawing.state.ready &&
    (props.drawing.state.hasDrawing || !!props.prompt.trim())
  return <section class="studio-board-inpaint" aria-label="智能重绘选项" style={{
    left: `${props.anchor.left}px`, top: `${props.anchor.top}px`, width: `${props.anchor.width}px`,
    visibility: props.hidden ? "hidden" : undefined,
  }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}>
    <div class="studio-board-inpaint-tools">
      <div class="studio-board-inpaint-modes" role="radiogroup" aria-label="重绘模式">
        <For each={[{ label: "重绘", value: "qwen_image_edit" }, { label: "消除", value: "erase" }] as const}>
          {(option) => <label>
            <input type="radio" name="studio-board-inpaint-mode" value={option.value}
              checked={props.mode === option.value} disabled={props.blocked} onChange={() => props.onMode(option.value)} />
            <span>{option.label}</span>
          </label>}
        </For>
      </div>
      <span class="studio-board-image-action-divider" />
      <label class="studio-board-inpaint-brush"><span>笔刷粗细</span>
        <input type="range" min="10" max="126" value={props.brushSize} aria-label="笔刷粗细"
          disabled={props.blocked} style={{ "--slider-progress": `${(props.brushSize - 10) / 116 * 100}%` }}
          onInput={(event) => props.onBrush(Number(event.currentTarget.value))} />
      </label>
      <span class="studio-board-image-action-divider" />
      <div class="studio-board-inpaint-history">
        <button type="button" class="clean" aria-label="清空" title="清空"
          disabled={props.blocked || !props.drawing.state.hasDrawing} onClick={props.drawing.clear} />
        <button type="button" class="undo" aria-label="撤销" title="撤销"
          disabled={props.blocked || !props.drawing.state.undoCount} onClick={props.drawing.undo} />
        <button type="button" class="redo" aria-label="重做" title="重做"
          disabled={props.blocked || !props.drawing.state.redoCount} onClick={props.drawing.redo} />
      </div>
    </div>
    <div class="studio-board-inpaint-input">
      <textarea maxlength="2000" aria-label="智能重绘提示词" value={props.prompt} disabled={props.blocked}
        placeholder={props.mode === "erase" ? "请输入想要消除的物体，可留空"
          : "重绘所选区域：“更改/替换/去除+对象+保留部分（可选）”，例：去除衣服上的文字。使用具体词汇生成效果更稳定。"}
        onInput={(event) => props.onPrompt(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
          event.preventDefault()
          if (canGenerate()) props.onGenerate()
        }} />
      <div class="studio-board-inpaint-buttons">
        <button type="button" disabled={props.blocked} onClick={props.onCancel}>取消</button>
        <button type="button" class="generate" disabled={!canGenerate()} onClick={props.onGenerate}>
          {props.preparing ? "处理中…" : "生成"}
        </button>
      </div>
    </div>
    <Show when={props.error || props.drawing.state.error}>
      {(error) => <div class="studio-board-inpaint-error" role="alert">{error()}</div>}
    </Show>
  </section>
}
