import { batch, createEffect, createMemo, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import {
  STUDIO_OUTPAINT_RATIOS,
  type StudioOutpaintMetrics,
  type StudioOutpaintRatio,
} from "@opencode-ai/core/studio-outpaint"

type OutpaintBox = { x: number; y: number; width: number; height: number }
type OutpaintHandle = "top-left" | "top" | "top-right" | "left" | "right" | "bottom-left" | "bottom" | "bottom-right"
export type StudioOutpaintInput = {
  prompt: string
  extra: StudioOutpaintMetrics & { ratio?: StudioOutpaintRatio; numImage: 1 }
}
const INSET = 8
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const ratioNumber = (ratio: StudioOutpaintRatio) => Number(ratio.split(":")[0]) / Number(ratio.split(":")[1])
function ratioDimensions(width: number, height: number, ratio: StudioOutpaintRatio) {
  return ratioNumber(ratio) > width / height
    ? { width: height * ratioNumber(ratio), height }
    : { width, height: width / ratioNumber(ratio) }
}
export function resizeStudioOutpaintBox(input: {
  rect: OutpaintBox
  image: OutpaintBox
  stage: { width: number; height: number }
  handle: OutpaintHandle
  dx: number
  dy: number
}) {
  const x = input.handle.includes("left") ? clamp(input.rect.x + input.dx, INSET, input.image.x) : input.rect.x
  const y = input.handle.includes("top") ? clamp(input.rect.y + input.dy, INSET, input.image.y) : input.rect.y
  const right = input.handle.includes("right")
    ? clamp(input.rect.x + input.rect.width + input.dx, input.image.x + input.image.width, input.stage.width - INSET)
    : input.rect.x + input.rect.width
  const bottom = input.handle.includes("bottom")
    ? clamp(input.rect.y + input.rect.height + input.dy, input.image.y + input.image.height, input.stage.height - INSET)
    : input.rect.y + input.rect.height
  return { x, y, width: Math.max(input.image.width, right - x), height: Math.max(input.image.height, bottom - y) }
}

export function createStudioOutpaint(props: {
  source: () => string | undefined
  key?: () => string | undefined
  busy: () => boolean
  stage?: { width: number; height: number }
}) {
  const [state, setState] = createStore({
    stage: props.stage ?? { width: 828, height: 420 },
    sourceSize: { width: 0, height: 0 },
    rect: undefined as OutpaintBox | undefined,
    ratio: undefined as StudioOutpaintRatio | undefined,
    ready: false,
    error: "",
    dragging: false,
  })
  let element: HTMLDivElement | undefined
  let observer: ResizeObserver | undefined
  let token = 0
  let stopDrag: (() => void) | undefined
  const image = createMemo(() => {
    const width = Math.max(1, state.sourceSize.width)
    const height = Math.max(1, state.sourceSize.height)
    const usable = { width: state.stage.width - INSET * 2, height: state.stage.height - INSET * 2 }
    const scale = Math.min(
      (usable.width * 0.4) / width,
      (usable.height * 0.4) / height,
      ...STUDIO_OUTPAINT_RATIOS.map((ratio) => {
        const target = ratioDimensions(width, height, ratio)
        return Math.min(usable.width / target.width, usable.height / target.height)
      }),
    )
    return {
      x: (state.stage.width - width * scale) / 2,
      y: (state.stage.height - height * scale) / 2,
      width: width * scale,
      height: height * scale,
    }
  })
  const rect = () => state.rect ?? image()
  const metrics = createMemo<StudioOutpaintMetrics>(() => {
    const scale = image().width / Math.max(1, state.sourceSize.width)
    const left = Math.max(0, Math.round((image().x - rect().x) / scale))
    const right = Math.max(0, Math.round((rect().x + rect().width - image().x - image().width) / scale))
    const top = Math.max(0, Math.round((image().y - rect().y) / scale))
    const bottom = Math.max(0, Math.round((rect().y + rect().height - image().y - image().height) / scale))
    return {
      sourceWidth: state.sourceSize.width,
      sourceHeight: state.sourceSize.height,
      left,
      right,
      top,
      bottom,
      realWidth: state.sourceSize.width + left + right,
      realHeight: state.sourceSize.height + top + bottom,
    }
  })
  const canSubmit = () =>
    state.ready &&
    !props.busy() &&
    [metrics().left, metrics().right, metrics().top, metrics().bottom].some((value) => value > 0)
  function finish() {
    stopDrag?.()
  }
  function applyRatio(ratio: StudioOutpaintRatio) {
    if (!state.ready || props.busy()) return
    finish()
    const target = ratioDimensions(image().width, image().height, ratio)
    setState({
      ratio,
      rect: {
        x: clamp(image().x + (image().width - target.width) / 2, INSET, state.stage.width - INSET - target.width),
        y: clamp(image().y + (image().height - target.height) / 2, INSET, state.stage.height - INSET - target.height),
        ...target,
      },
    })
  }
  function down(handle: OutpaintHandle, event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (event.button !== 0 || !state.ready || props.busy()) return
    finish()
    const bounds = element?.getBoundingClientRect()
    const start = {
      x: event.clientX,
      y: event.clientY,
      rect: { ...rect() },
      image: { ...image() },
      stage: { ...state.stage },
    }
    const scale = {
      x: bounds?.width ? state.stage.width / bounds.width : 1,
      y: bounds?.height ? state.stage.height / bounds.height : 1,
    }
    const target = event.currentTarget as HTMLButtonElement
    target.setPointerCapture(event.pointerId)
    setState("dragging", true)
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      setState(
        "rect",
        resizeStudioOutpaintBox({
          ...start,
          handle,
          dx: (next.clientX - start.x) * scale.x,
          dy: (next.clientY - start.y) * scale.y,
        }),
      )
    }
    const up = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) finish()
    }
    stopDrag = () => {
      stopDrag = undefined
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      document.removeEventListener("pointercancel", up)
      target.removeEventListener("lostpointercapture", finish)
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
      setState({
        dragging: false,
        ratio: STUDIO_OUTPAINT_RATIOS.find(
          (ratio) => Math.abs(rect().width / rect().height - ratioNumber(ratio)) < 0.02,
        ),
      })
    }
    target.addEventListener("lostpointercapture", finish)
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", up)
  }
  function detach() {
    finish()
    observer?.disconnect()
    element = undefined
  }
  function attach(node: HTMLDivElement) {
    element = node
    observer?.disconnect()
    if (props.stage) return
    observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box?.width || !box.height) return
      const width = Math.max(360, box.width)
      const height = Math.max(280, box.height)
      if (width === state.stage.width && height === state.stage.height) return
      finish()
      setState({ stage: { width, height }, rect: undefined, ratio: undefined })
    })
    queueMicrotask(() => {
      if (element === node) observer?.observe(node.parentElement ?? node)
    })
  }
  createEffect(
    on(
      () => [props.source(), props.key?.()] as const,
      ([url]) => {
        const current = ++token
        finish()
        setState({ ready: false, error: "", rect: undefined, ratio: undefined, sourceSize: { width: 0, height: 0 } })
        if (!url) return
        const loaded = new Image()
        loaded.crossOrigin = "anonymous"
        loaded.onload = () => {
          if (current !== token) return
          if (!loaded.naturalWidth || !loaded.naturalHeight) {
            setState("error", "无法读取图片尺寸")
            return
          }
          batch(() => {
            setState("sourceSize", { width: loaded.naturalWidth, height: loaded.naturalHeight })
            setState("ready", true)
          })
        }
        loaded.onerror = () => {
          if (current === token) setState("error", "图片加载失败")
        }
        loaded.src = url
      },
    ),
  )
  window.addEventListener("blur", finish)
  onCleanup(() => {
    token++
    detach()
    window.removeEventListener("blur", finish)
  })
  return {
    state,
    image,
    rect,
    metrics,
    canSubmit,
    blocked: props.busy,
    applyRatio,
    down,
    attach,
    detach,
    finish,
    input: (prompt: string): StudioOutpaintInput => ({
      prompt: prompt.trim(),
      extra: { ...metrics(), ratio: state.ratio, numImage: 1 },
    }),
  }
}
export type StudioOutpaint = ReturnType<typeof createStudioOutpaint>

export function StudioOutpaintStage(props: { editor: StudioOutpaint; source: string; board?: boolean; zoom?: number }) {
  const editor = props.editor
  onCleanup(editor.detach)
  return (
    <div
      ref={editor.attach}
      class="studio-enlarging-stage"
      classList={{ "studio-board-outpaint-stage": props.board }}
      style={{
        width: `${editor.state.stage.width}px`,
        height: `${editor.state.stage.height}px`,
        left: props.board ? `${-editor.rect().x}px` : undefined,
        top: props.board ? `${-editor.rect().y}px` : undefined,
        "--outpaint-zoom": props.zoom ?? 1,
      }}
    >
      <div
        class="studio-enlarging-selection"
        style={{
          left: `${editor.rect().x}px`,
          top: `${editor.rect().y}px`,
          width: `${editor.rect().width}px`,
          height: `${editor.rect().height}px`,
        }}
      >
        <For
          each={
            [
              ["top-left", "nwse-resize"],
              ["top", "ns-resize"],
              ["top-right", "nesw-resize"],
              ["left", "ew-resize"],
              ["right", "ew-resize"],
              ["bottom-left", "nesw-resize"],
              ["bottom", "ns-resize"],
              ["bottom-right", "nwse-resize"],
            ] as const
          }
        >
          {(item) => (
            <button
              type="button"
              class={`studio-enlarging-handle studio-enlarging-handle-${item[0]}`}
              style={{ cursor: item[1] }}
              aria-label={`调整${item[0]}`}
              disabled={!editor.state.ready || editor.blocked()}
              on:pointerdown={(event) => editor.down(item[0], event)}
              on:mousedown={(event) => event.stopPropagation()}
              on:click={(event) => event.stopPropagation()}
            />
          )}
        </For>
      </div>
      <img
        src={props.source}
        class="studio-enlarging-image"
        draggable={false}
        alt="Outpaint source"
        style={{
          left: `${editor.image().x}px`,
          top: `${editor.image().y}px`,
          width: `${editor.image().width}px`,
          height: `${editor.image().height}px`,
        }}
      />
    </div>
  )
}
