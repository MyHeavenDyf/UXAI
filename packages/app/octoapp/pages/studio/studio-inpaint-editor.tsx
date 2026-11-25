import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { tracker } from "@/utils/tracker"
import type { StudioImage } from "./types"
import type { StudioInpaintMode } from "./studio-shared"
import { createStudioInpaintDrawing, StudioInpaintCanvas, type StudioInpaintInput } from "./studio-inpaint-canvas"

export function StudioInpaintEditor(props: {
  image: StudioImage
  busy: boolean
  onClose: () => void
  onDelete: () => void
  onSubmit: (input: StudioInpaintInput) => void
}): JSX.Element {
  const [editMode, setEditMode] = createSignal<StudioInpaintMode>("qwen_image_edit")
  const [brushSize, setBrushSize] = createSignal(40)
  const [editorPrompt, setEditorPrompt] = createSignal("")
  const [displaySize, setDisplaySize] = createSignal({ width: 0, height: 0 })
  const [loadError, setLoadError] = createSignal("")
  const drawing = createStudioInpaintDrawing({
    source: () => props.image.remoteUrl ?? props.image.url,
    key: () => props.image.id,
    brushSize,
    busy: () => props.busy,
  })
  const sourceSize = () => drawing.state.size
  const hasDrawing = () => drawing.state.hasDrawing
  const clearMask = drawing.clear
  const undoMask = drawing.undo
  const redoMask = drawing.redo
  let canvasWrapRef!: HTMLDivElement

  function updateDisplaySize() {
    const width = sourceSize().width
    const height = sourceSize().height
    if (!canvasWrapRef || !width || !height) return
    const rect = canvasWrapRef.getBoundingClientRect()
    const scale = Math.min(
      Math.max(1, rect.width - 48) / width,
      Math.max(1, rect.height - 48) / height,
      1,
    )
    setDisplaySize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    })
  }

  createEffect(
    on(
      () => `${props.image.id}:${props.image.url}`,
      () => {
        setLoadError("")
        setEditorPrompt("")
        setEditMode("qwen_image_edit")
      },
    ),
  )

  createEffect(() => {
    const observer = new ResizeObserver(() => updateDisplaySize())
    observer.observe(canvasWrapRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    sourceSize().width
    sourceSize().height
    requestAnimationFrame(updateDisplaySize)
  })

  function submit() {
    drawing.finish()
    const nextHasDrawing = drawing.state.hasDrawing
    // Allow one-click generation without painting as long as there is a prompt.
    if ((!nextHasDrawing && !editorPrompt().trim()) || props.busy || !drawing.state.ready) return
    try {
      props.onSubmit({
        prompt: editorPrompt().trim(),
        mode: editMode(),
        brushSize: brushSize(),
        sourceImage: props.image.remoteUrl ?? props.image.url,
        compositeImage: drawing.composite(),
        hasDrawing: nextHasDrawing,
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const promptPlaceholder = createMemo(() =>
    editMode() === "erase"
      ? "请输入想要消除的物体，可留空"
      : hasDrawing()
        ? "重绘所选区域：例如把花瓶改成台灯"
        : `重绘所选区域："更改/替换/去除+对象+保留部分（可选）"，例：去除衣服上的文字。使用具体词汇生成效果更稳定。`,
  )

  return (
    <div class="studio-inpaint">
      <div class="studio-inpaint-header">
        <span class="studio-canvas-tab">
          <span class="studio-canvas-label-text">智能重绘</span>
          <span class="studio-canvas-tab-close" onClick={() => { tracker.interaction({ module: "studio", name: "inpaint-close" }); props.onClose() }} aria-label="关闭智能重绘" title="关闭智能重绘" />
        </span>
      </div>
      <div class="studio-inpaint-body">
        <div class="studio-inpaint-hint">
          <img src="/studio/studio_help_tips.png" alt="" class="studio-inpaint-hint-icon" />
          <span>通过涂抹生成修改图片局部</span>
        </div>
        <div ref={canvasWrapRef!} class="studio-inpaint-canvas-wrap">
          <Show when={displaySize().width && displaySize().height} fallback={
            <div class="studio-inpaint-loading">{loadError() || drawing.state.error || "图片加载中..."}</div>
          }>
            <div
              class="studio-inpaint-stage"
              style={{ width: `${displaySize().width}px`, height: `${displaySize().height}px` }}
            >
              <img
                src={props.image.url}
                class="studio-inpaint-image"
                alt="Inpaint source"
                draggable={false}
              />
              <StudioInpaintCanvas drawing={drawing} />
            </div>
          </Show>
          <Show when={loadError() || drawing.state.error}>
            {(message) => <div class="studio-inpaint-error">{message()}</div>}
          </Show>
        </div>
        <div class="studio-inpaint-controls">
          <div class="studio-inpaint-toolbar">
            <div class="studio-inpaint-mode-group" aria-label="生成模式">
              <span class="studio-inpaint-mode-label">生成模式</span>
              <For each={[
                { label: "重绘", value: "qwen_image_edit" },
                { label: "消除", value: "erase" },
              ] as const}>
                {(option) => (
                  <button
                    type="button"
                    class="studio-inpaint-mode-option"
                    classList={{ active: editMode() === option.value }}
                    aria-pressed={editMode() === option.value}
                    onClick={() => {
                      tracker.interaction({ module: "studio", name: "inpaint-mode", extend: JSON.stringify({ mode: option.value }) })
                      setEditMode(option.value)
                    }}
                  >
                    <span class="studio-inpaint-mode-dot" />
                    <span class="studio-inpaint-mode-text">{option.label}</span>
                  </button>
                )}
              </For>
            </div>
            <div class="studio-inpaint-tool-group">
              <div class="studio-inpaint-tool-row">
                <button
                  type="button"
                  onClick={() => { tracker.interaction({ module: "studio", name: "inpaint-clear" }); clearMask() }}
                  disabled={!hasDrawing() || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-clean"
                  aria-label="清空"
                  title="清空"
                />
                <button
                  type="button"
                  onClick={() => { tracker.interaction({ module: "studio", name: "inpaint-undo" }); undoMask() }}
                  disabled={drawing.state.undoCount === 0 || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-undo"
                  aria-label="撤销"
                  title="撤销"
                />
                <button
                  type="button"
                  onClick={() => { tracker.interaction({ module: "studio", name: "inpaint-redo" }); redoMask() }}
                  disabled={drawing.state.redoCount === 0 || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-redo"
                  aria-label="重做"
                  title="重做"
                />
              </div>
              <label class="studio-inpaint-brush">
                <span>笔刷粗细</span>
                <strong>{brushSize()}</strong>
                <input
                  type="range"
                  min="10"
                  max="126"
                  value={brushSize()}
                  style={{ '--slider-progress': `${((brushSize() - 10) / 116) * 100}%` }}
                  onInput={(event) => {
                    const v = Number(event.currentTarget.value);
                    setBrushSize(v);
                    event.currentTarget.style.setProperty('--slider-progress', `${((v - 10) / 116) * 100}%`);
                  }}
                />
              </label>
            </div>
          </div>
          <div class="studio-inpaint-prompt-row">
          <div class="studio-inpaint-prompt-wrap">
            <textarea
              class="studio-inpaint-prompt"
              maxlength="2000"
              aria-label={promptPlaceholder()}
              value={editorPrompt()}
              disabled={props.busy}
              onInput={(event) => setEditorPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return
                event.preventDefault()
                submit()
              }}
            />
            <Show when={!editorPrompt()}>
              <div class="studio-inpaint-prompt-placeholder">{promptPlaceholder()}</div>
            </Show>
          </div>
            <button type="button" class="studio-editor-delete" onClick={() => { tracker.interaction({ module: "studio", name: "inpaint-delete" }); props.onDelete() }}>删除</button>
            <button
              type="button"
              disabled={(!hasDrawing() && !editorPrompt().trim()) || props.busy || !drawing.state.ready}
              onClick={submit}
              class="studio-hd-create"
            >
              一键生成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
