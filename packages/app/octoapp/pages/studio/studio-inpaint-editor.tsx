import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import type { StudioImage } from "./types"
import type { StudioInpaintMode } from "./studio-shared"

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function StudioInpaintEditor(props: {
  image: StudioImage
  busy: boolean
  onClose: () => void
  onDelete: () => void
  onSubmit: (input: {
    prompt: string
    mode: StudioInpaintMode
    sourceImage: string
    compositeImage: string
    hasDrawing: boolean
  }) => void
}): JSX.Element {
  const [editMode, setEditMode] = createSignal<StudioInpaintMode>("qwen_image_edit")
  const [brushSize, setBrushSize] = createSignal(40)
  const [editorPrompt, setEditorPrompt] = createSignal("")
  const [sourceSize, setSourceSize] = createSignal({ width: props.image.width ?? 0, height: props.image.height ?? 0 })
  const [displaySize, setDisplaySize] = createSignal({ width: 0, height: 0 })
  const [undoList, setUndoList] = createSignal<string[]>([])
  const [redoList, setRedoList] = createSignal<string[]>([])
  const [hasDrawing, setHasDrawing] = createSignal(false)
  const [loadError, setLoadError] = createSignal("")
  const [cursor, setCursor] = createSignal({ x: 0, y: 0, visible: false })
  const sourceMaskCanvas = document.createElement("canvas")
  let sourceImage: HTMLImageElement | undefined
  let canvasWrapRef!: HTMLDivElement
  let maskCanvasRef!: HTMLCanvasElement
  let drawing = false
  let lastPoint: { x: number; y: number } | undefined

  function renderMaskPreview() {
    const context = maskCanvasRef?.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, displaySize().width, displaySize().height)
    if (!sourceMaskCanvas.width || !sourceMaskCanvas.height) return
    context.drawImage(sourceMaskCanvas, 0, 0, displaySize().width, displaySize().height)
  }

  function resetMaskCanvas(width: number, height: number) {
    sourceMaskCanvas.width = width
    sourceMaskCanvas.height = height
    const initialState = sourceMaskCanvas.toDataURL("image/png")
    setUndoList([initialState])
    setRedoList([])
    setHasDrawing(false)
    renderMaskPreview()
  }

  function updateHasDrawing() {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context || !sourceMaskCanvas.width || !sourceMaskCanvas.height) {
      setHasDrawing(false)
      return false
    }
    const pixels = context.getImageData(0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height).data
    const nextHasDrawing = pixels.some((value, index) => index % 4 === 3 && value > 0)
    setHasDrawing(nextHasDrawing)
    return nextHasDrawing
  }

  function restoreMaskState(state: string) {
    const image = new Image()
    image.onload = () => {
      const context = sourceMaskCanvas.getContext("2d")
      if (!context) return
      context.clearRect(0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height)
      context.drawImage(image, 0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height)
      updateHasDrawing()
      renderMaskPreview()
    }
    image.src = state
  }

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
        const image = new Image()
        if (/^https?:\/\//i.test(props.image.url)) image.crossOrigin = "anonymous"
        image.onload = () => {
          sourceImage = image
          setSourceSize({ width: image.naturalWidth, height: image.naturalHeight })
          resetMaskCanvas(image.naturalWidth, image.naturalHeight)
          requestAnimationFrame(updateDisplaySize)
        }
        image.onerror = () => setLoadError("图片加载失败")
        image.src = props.image.url
      },
    ),
  )

  createEffect(() => {
    const observer = new ResizeObserver(() => updateDisplaySize())
    observer.observe(canvasWrapRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    displaySize()
    requestAnimationFrame(renderMaskPreview)
  })

  function toSourcePoint(event: PointerEvent) {
    const rect = maskCanvasRef.getBoundingClientRect()
    return {
      x: clamp((event.clientX - rect.left) / rect.width * sourceMaskCanvas.width, 0, sourceMaskCanvas.width),
      y: clamp((event.clientY - rect.top) / rect.height * sourceMaskCanvas.height, 0, sourceMaskCanvas.height),
    }
  }

  function updateCursor(event: PointerEvent, visible: boolean) {
    const rect = maskCanvasRef.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    setCursor({
      x,
      y,
      visible: visible && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height,
    })
  }

  function drawDot(point: { x: number; y: number }) {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context) return
    const scale = displaySize().width / sourceMaskCanvas.width
    context.fillStyle = "rgba(137, 71, 213, 0.3)"
    context.beginPath()
    context.arc(point.x, point.y, brushSize() / Math.max(scale, 0.001) / 2, 0, Math.PI * 2)
    context.fill()
  }

  function drawLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context) return
    const scale = displaySize().width / sourceMaskCanvas.width
    context.strokeStyle = "rgba(137, 71, 213, 0.3)"
    context.lineCap = "round"
    context.lineJoin = "round"
    context.lineWidth = brushSize() / Math.max(scale, 0.001)
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }

  function finishDrawing() {
    if (!drawing) return
    drawing = false
    lastPoint = undefined
    const nextState = sourceMaskCanvas.toDataURL("image/png")
    setUndoList((items) => [...items, nextState])
    setRedoList([])
    updateHasDrawing()
    renderMaskPreview()
  }

  function clearMask() {
    const context = sourceMaskCanvas.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, sourceMaskCanvas.width, sourceMaskCanvas.height)
    const initialState = sourceMaskCanvas.toDataURL("image/png")
    setUndoList([initialState])
    setRedoList([])
    setHasDrawing(false)
    renderMaskPreview()
  }

  function undoMask() {
    const current = undoList().at(-1)
    const previous = undoList().at(-2)
    if (!current || !previous) return
    setUndoList((items) => items.slice(0, -1))
    setRedoList((items) => [...items, current])
    restoreMaskState(previous)
  }

  function redoMask() {
    const next = redoList().at(-1)
    if (!next) return
    setRedoList((items) => items.slice(0, -1))
    setUndoList((items) => [...items, next])
    restoreMaskState(next)
  }

  function handlePointerDown(event: PointerEvent) {
    if (!sourceMaskCanvas.width || !sourceMaskCanvas.height || props.busy) return
    event.preventDefault()
    maskCanvasRef.setPointerCapture(event.pointerId)
    drawing = true
    lastPoint = toSourcePoint(event)
    drawDot(lastPoint)
    updateCursor(event, true)
    renderMaskPreview()
  }

  function handlePointerMove(event: PointerEvent) {
    updateCursor(event, true)
    if (!drawing || !lastPoint) return
    const nextPoint = toSourcePoint(event)
    drawLine(lastPoint, nextPoint)
    lastPoint = nextPoint
    renderMaskPreview()
  }

  function handlePointerUp(event: PointerEvent) {
    updateCursor(event, true)
    if (maskCanvasRef.hasPointerCapture(event.pointerId)) maskCanvasRef.releasePointerCapture(event.pointerId)
    finishDrawing()
  }

  function createCompositeImage() {
    if (!sourceImage) throw new Error("图片尚未加载完成")
    const canvas = document.createElement("canvas")
    canvas.width = sourceSize().width
    canvas.height = sourceSize().height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法创建局部重绘画布")
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)
    context.drawImage(sourceMaskCanvas, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/png").split(",")[1] ?? ""
  }

  function submit() {
    const nextHasDrawing = updateHasDrawing()
    if (!nextHasDrawing || props.busy) return
    try {
      props.onSubmit({
        prompt: editorPrompt().trim(),
        mode: editMode(),
        sourceImage: props.image.remoteUrl ?? props.image.url,
        compositeImage: createCompositeImage(),
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
        : "涂抹要修改的区域，并描述希望变成什么",
  )

  return (
    <div class="studio-inpaint">
      <div class="studio-inpaint-header">
        <div class="min-w-0">
          <div class="studio-inpaint-title">局部重绘</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-inpaint-close" aria-label="关闭局部重绘" title="关闭局部重绘" />
      </div>
      <div class="studio-inpaint-body">
        <div ref={canvasWrapRef!} class="studio-inpaint-canvas-wrap">
          <Show when={displaySize().width && displaySize().height} fallback={
            <div class="studio-inpaint-loading">{loadError() || "图片加载中..."}</div>
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
              <canvas
                ref={maskCanvasRef!}
                class="studio-inpaint-mask"
                width={displaySize().width}
                height={displaySize().height}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={(event) => {
                  updateCursor(event, false)
                  finishDrawing()
                }}
              />
              <Show when={cursor().visible}>
                <span
                  class="studio-inpaint-cursor"
                  style={{
                    left: `${cursor().x}px`,
                    top: `${cursor().y}px`,
                    width: `${brushSize()}px`,
                    height: `${brushSize()}px`,
                  }}
                />
              </Show>
            </div>
          </Show>
          <Show when={loadError()}>
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
                    onClick={() => setEditMode(option.value)}
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
                  onClick={clearMask}
                  disabled={!hasDrawing() || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-clean"
                  aria-label="清空"
                  title="清空"
                />
                <button
                  type="button"
                  onClick={undoMask}
                  disabled={undoList().length < 2 || props.busy}
                  class="studio-inpaint-tool studio-inpaint-tool-undo"
                  aria-label="撤销"
                  title="撤销"
                />
                <button
                  type="button"
                  onClick={redoMask}
                  disabled={redoList().length === 0 || props.busy}
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
                  onInput={(event) => setBrushSize(Number(event.currentTarget.value))}
                />
              </label>
            </div>
          </div>
          <div class="studio-inpaint-prompt-row">
            <textarea
              class="studio-inpaint-prompt"
              maxlength="2000"
              placeholder={promptPlaceholder()}
              value={editorPrompt()}
              disabled={props.busy}
              onInput={(event) => setEditorPrompt(event.currentTarget.value)}
            />
            <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
            <button
              type="button"
              disabled={!hasDrawing() || props.busy}
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
