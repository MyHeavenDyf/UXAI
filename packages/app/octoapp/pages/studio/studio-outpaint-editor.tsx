import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { STUDIO_ASPECT_RATIOS } from "./data"
import { StudioMediaPreview } from "./studio-conversation"
import type { StudioAspectRatio, StudioImage } from "./types"

type OutpaintBox = {
  x: number
  y: number
  width: number
  height: number
}

type OutpaintHandle = "top-left" | "top" | "top-right" | "left" | "right" | "bottom-left" | "bottom" | "bottom-right"

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function ratioBox(imageBox: OutpaintBox, stage: { width: number; height: number }, ratio: StudioAspectRatio): OutpaintBox {
  const ratioValue =
    ratio === "16:9"
      ? 16 / 9
      : ratio === "9:16"
        ? 9 / 16
        : 1
  const imageRatio = imageBox.width / imageBox.height
  const width = ratioValue > imageRatio ? imageBox.height * ratioValue : imageBox.width
  const height = ratioValue > imageRatio ? imageBox.height : imageBox.width / ratioValue
  return {
    x: clamp(imageBox.x + (imageBox.width - width) / 2, 0, stage.width - width),
    y: clamp(imageBox.y + (imageBox.height - height) / 2, 0, stage.height - height),
    width,
    height,
  }
}

function resizeOutpaintBox(input: {
  rect: OutpaintBox
  imageBox: OutpaintBox
  stage: { width: number; height: number }
  handle: OutpaintHandle
  dx: number
  dy: number
}): OutpaintBox {
  const next = { ...input.rect }
  const imageRight = input.imageBox.x + input.imageBox.width
  const imageBottom = input.imageBox.y + input.imageBox.height
  if (input.handle.includes("left")) {
    next.x = clamp(input.rect.x + input.dx, 0, input.imageBox.x)
    next.width = input.rect.x + input.rect.width - next.x
  }
  if (input.handle.includes("right")) {
    next.width = clamp(input.rect.x + input.rect.width + input.dx, imageRight, input.stage.width) - next.x
  }
  if (input.handle.includes("top")) {
    next.y = clamp(input.rect.y + input.dy, 0, input.imageBox.y)
    next.height = input.rect.y + input.rect.height - next.y
  }
  if (input.handle.includes("bottom")) {
    next.height = clamp(input.rect.y + input.rect.height + input.dy, imageBottom, input.stage.height) - next.y
  }
  return {
    x: next.x,
    y: next.y,
    width: Math.max(input.imageBox.width, next.width),
    height: Math.max(input.imageBox.height, next.height),
  }
}

export function StudioOutpaintEditor(props: {
  image: StudioImage
  aspectRatio: StudioAspectRatio
  onAspectRatio: (value: StudioAspectRatio) => void
  onClose: () => void
  onDelete: () => void
  onSubmit: (input: { prompt: string; extra: Record<string, unknown> }) => void
}): JSX.Element {
  const [editorPrompt, setEditorPrompt] = createSignal("")
  const [stage, setStage] = createSignal({ width: 828, height: 420 })
  const [rect, setRect] = createSignal<OutpaintBox>()
  const [imageSourceSize, setImageSourceSize] = createSignal({ width: props.image.width ?? 1024, height: props.image.height ?? 1024 })
  const [localAspectRatio, setLocalAspectRatio] = createSignal<StudioAspectRatio | undefined>(undefined)
  const ratios = ["1:1", "9:16", "16:9"] as StudioAspectRatio[]
  let stageRef!: HTMLDivElement

  createEffect(
    on(
      () => `${props.image.id}:${props.image.url}:${props.image.width ?? ""}:${props.image.height ?? ""}`,
      () => {
        if (props.image.width && props.image.height) {
          setImageSourceSize({ width: props.image.width, height: props.image.height })
          return
        }
        const image = new Image()
        image.onload = () => setImageSourceSize({ width: image.naturalWidth, height: image.naturalHeight })
        image.src = props.image.url
      },
    ),
  )

  const imageBox = createMemo<OutpaintBox>(() => {
    const sourceWidth = imageSourceSize().width
    const sourceHeight = imageSourceSize().height
    const maxWidth = Math.min(320, stage().width * 0.42)
    const maxHeight = stage().height * 0.56
    const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    return {
      x: (stage().width - width) / 2,
      y: (stage().height - height) / 2,
      width,
      height,
    }
  })

  createEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setStage({
        width: Math.max(360, entry.contentRect.width),
        height: Math.max(280, entry.contentRect.height),
      })
    })
    observer.observe(stageRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(
    on(
      () => `${props.image.id}:${stage().width}:${stage().height}:${imageSourceSize().width}:${imageSourceSize().height}`,
      () => setRect(imageBox()),
      { defer: true },
    ),
  )

  function applyRatio(ratio: StudioAspectRatio) {
    setLocalAspectRatio(ratio)
    setRect(ratioBox(imageBox(), stage(), ratio))
  }

  function handlePointerDown(handle: OutpaintHandle, event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startRect = rect() ?? imageBox()
    function onMove(moveEvent: PointerEvent) {
      setRect(resizeOutpaintBox({
        rect: startRect,
        imageBox: imageBox(),
        stage: stage(),
        handle,
        dx: moveEvent.clientX - startX,
        dy: moveEvent.clientY - startY,
      }))
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
  }

  const outpaintMetrics = createMemo(() => {
    const current = rect() ?? imageBox()
    const scale = imageBox().width / imageSourceSize().width
    const left = Math.round((imageBox().x - current.x) / scale)
    const right = Math.round((current.x + current.width - imageBox().x - imageBox().width) / scale)
    const top = Math.round((imageBox().y - current.y) / scale)
    const bottom = Math.round((current.y + current.height - imageBox().y - imageBox().height) / scale)
    return {
      left: Math.max(0, left),
      right: Math.max(0, right),
      top: Math.max(0, top),
      bottom: Math.max(0, bottom),
      realWidth: Math.round(current.width / scale),
      realHeight: Math.round(current.height / scale),
    }
  })
  const canSubmit = createMemo(() =>
    outpaintMetrics().left > 0 ||
    outpaintMetrics().right > 0 ||
    outpaintMetrics().top > 0 ||
    outpaintMetrics().bottom > 0,
  )
  return (
    <div class="studio-enlarging">
      <div class="studio-enlarging-header">
        <div class="min-w-0">
          <div class="studio-enlarging-title">扩图</div>
        </div>
        <button type="button" onClick={props.onClose} class="studio-enlarging-close" aria-label="关闭扩图" title="关闭扩图" />
      </div>
      <div class="studio-enlarging-body">
        <div ref={stageRef!} class="studio-enlarging-canvas-wrap">
          <div class="studio-enlarging-stage" style={{ width: `${stage().width}px`, height: `${stage().height}px` }}>
            <div
              class="studio-enlarging-selection"
              style={{
                left: `${(rect() ?? imageBox()).x}px`,
                top: `${(rect() ?? imageBox()).y}px`,
                width: `${(rect() ?? imageBox()).width}px`,
                height: `${(rect() ?? imageBox()).height}px`,
              }}
            >
              <For each={[
                ["top-left", "nwse-resize"],
                ["top", "ns-resize"],
                ["top-right", "nesw-resize"],
                ["left", "ew-resize"],
                ["right", "ew-resize"],
                ["bottom-left", "nesw-resize"],
                ["bottom", "ns-resize"],
                ["bottom-right", "nwse-resize"],
              ] as const}>
                {(item) => (
                  <button
                    type="button"
                    class={`studio-enlarging-handle studio-enlarging-handle-${item[0]}`}
                    style={{ cursor: item[1] }}
                    aria-label={`调整${item[0]}`}
                    onPointerDown={(event) => handlePointerDown(item[0], event)}
                  />
                )}
              </For>
            </div>
            <img
              src={props.image.url}
              class="studio-enlarging-image"
              style={{
                left: `${imageBox().x}px`,
                top: `${imageBox().y}px`,
                width: `${imageBox().width}px`,
                height: `${imageBox().height}px`,
              }}
              alt="Outpaint source"
            />
          </div>
        </div>
        <div class="studio-enlarging-controls">
          <div class="studio-enlarging-ratios" aria-label="扩图比例">
          <For each={ratios}>
            {(item) => (
              <button
                type="button"
                onClick={() => applyRatio(item)}
                class="studio-enlarging-ratio"
                classList={{ active: item === localAspectRatio() }}
              >
                {item}
              </button>
            )}
          </For>
            <span class="studio-enlarging-distance">
              左 {outpaintMetrics().left} · 右 {outpaintMetrics().right} · 上 {outpaintMetrics().top} · 下 {outpaintMetrics().bottom}
            </span>
          </div>
          <div class="studio-enlarging-prompt-row">
          <textarea
            class="studio-enlarging-prompt"
            maxlength="2000"
            placeholder="描述希望扩展出的画面内容"
            value={editorPrompt()}
            onInput={(event) => setEditorPrompt(event.currentTarget.value)}
          />
          <button type="button" class="studio-editor-delete" onClick={props.onDelete}>删除</button>
          <button
            type="button"
            disabled={!canSubmit()}
            onClick={() => props.onSubmit({
              prompt: editorPrompt().trim(),
              extra: {
                ...outpaintMetrics(),
                numImage: 1,
                ratio: localAspectRatio() ?? props.aspectRatio,
              },
            })}
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

function currentImageName(image: StudioImage) {
  return image.localPath?.split("/").at(-1) ?? image.id
}

function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="studio-detail-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function StudioGlassSphere(): JSX.Element {
  return (
    <div
      class="w-[210px] h-[210px] rounded-full"
      style={{
        background:
          "radial-gradient(circle at 35% 24%, rgba(133,207,255,0.95), transparent 23%), radial-gradient(circle at 36% 42%, rgba(191,137,255,0.72), transparent 30%), radial-gradient(circle at 68% 68%, rgba(255,255,255,0.9), transparent 22%), linear-gradient(135deg, rgba(156,185,255,0.64), rgba(213,243,255,0.88))",
        "box-shadow": "0 28px 80px rgba(73, 123, 255, 0.25), inset -18px -22px 30px rgba(82, 151, 255, 0.12), inset 12px 14px 28px rgba(255,255,255,0.52)",
      }}
    />
  )
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}
