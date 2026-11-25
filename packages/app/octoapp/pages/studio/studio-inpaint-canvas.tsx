import { createEffect, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { StudioInpaintMode } from "./studio-shared"

export type StudioInpaintInput = {
  prompt: string
  mode: StudioInpaintMode
  brushSize: number
  sourceImage: string
  compositeImage: string
  hasDrawing: boolean
}

export function studioInpaintPrompt(input: Pick<StudioInpaintInput, "prompt" | "mode" | "hasDrawing">) {
  return input.prompt.trim() || (input.hasDrawing
    ? input.mode === "erase" ? "消除涂抹区域内的物体" : "重绘所选区域"
    : input.mode === "erase" ? "消除图中的物体" : "重绘图片")
}

export function createStudioInpaintDrawing(props: {
  source: () => string | undefined
  key?: () => string | undefined
  brushSize: () => number
  busy: () => boolean
}) {
  const [state, setState] = createStore({
    size: { width: 0, height: 0 },
    ready: false,
    error: "",
    hasDrawing: false,
    drawing: false,
    undoCount: 0,
    redoCount: 0,
    cursor: { x: 0, y: 0, scale: 1, visible: false },
  })
  const mask = document.createElement("canvas")
  const history: { points: { x: number; y: number }[]; width: number }[] = []
  const future: (typeof history)[number][] = []
  let stroke: (typeof history)[number] | undefined
  let source: HTMLImageElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let observer: ResizeObserver | undefined
  let pointerID: number | undefined
  let token = 0

  function render() {
    if (!canvas) return
    const context = canvas.getContext("2d")
    context?.clearRect(0, 0, canvas.width, canvas.height)
    if (mask.width && mask.height) context?.drawImage(mask, 0, 0, canvas.width, canvas.height)
  }
  function dot(point: { x: number; y: number }, width: number) {
    const context = mask.getContext("2d")!
    context.fillStyle = "rgba(137, 71, 213, 0.3)"
    context.beginPath()
    context.arc(point.x, point.y, width / 2, 0, Math.PI * 2)
    context.fill()
  }
  function line(from: { x: number; y: number }, to: { x: number; y: number }, width: number) {
    const context = mask.getContext("2d")!
    context.strokeStyle = "rgba(137, 71, 213, 0.3)"
    context.lineCap = "round"
    context.lineJoin = "round"
    context.lineWidth = width
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }
  function sync(repaint = false) {
    if (repaint) {
      mask.getContext("2d")?.clearRect(0, 0, mask.width, mask.height)
      history.forEach((item) => {
        dot(item.points[0], item.width)
        item.points.slice(1).forEach((point, index) => line(item.points[index], point, item.width))
      })
    }
    setState({ hasDrawing: history.length > 0, undoCount: history.length, redoCount: future.length })
    render()
  }
  function finish() {
    if (stroke) {
      history.push(stroke)
      future.length = 0
      stroke = undefined
      sync()
    }
    const captured = pointerID
    pointerID = undefined
    if (captured !== undefined && canvas?.hasPointerCapture(captured)) canvas.releasePointerCapture(captured)
    setState("drawing", false)
  }
  function clear() {
    finish()
    history.length = 0
    future.length = 0
    sync(true)
  }
  function undo() {
    if (props.busy()) return
    finish()
    const item = history.pop()
    if (item) future.push(item)
    sync(true)
  }
  function redo() {
    if (props.busy()) return
    finish()
    const item = future.pop()
    if (item) history.push(item)
    sync(true)
  }
  function cursor(event: PointerEvent, visible: boolean) {
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setState("cursor", {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
      scale: canvas.width / rect.width,
      visible: visible && state.ready && !props.busy() && event.clientX >= rect.left &&
        event.clientY >= rect.top && event.clientX <= rect.right && event.clientY <= rect.bottom,
    })
  }
  function point(event: PointerEvent) {
    const rect = canvas!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(mask.width, (event.clientX - rect.left) / rect.width * mask.width)),
      y: Math.max(0, Math.min(mask.height, (event.clientY - rect.top) / rect.height * mask.height)),
    }
  }
  function down(event: PointerEvent) {
    event.stopPropagation()
    if (event.button !== 0 || !state.ready || props.busy() || !canvas) return
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    pointerID = event.pointerId
    canvas.setPointerCapture(event.pointerId)
    stroke = { points: [point(event)], width: props.brushSize() * mask.width / rect.width }
    setState("drawing", true)
    dot(stroke.points[0], stroke.width)
    cursor(event, true)
    render()
  }
  function move(event: PointerEvent) {
    cursor(event, true)
    if (!stroke || event.pointerId !== pointerID) return
    const next = point(event)
    line(stroke.points.at(-1)!, next, stroke.width)
    stroke.points.push(next)
    render()
  }
  function up(event: PointerEvent) {
    if (event.pointerId !== pointerID) return
    finish()
    cursor(event, true)
  }
  function attach(element: HTMLCanvasElement) {
    observer?.disconnect()
    canvas = element
    const resize = () => {
      element.width = Math.max(1, Math.round(element.clientWidth))
      element.height = Math.max(1, Math.round(element.clientHeight))
      render()
    }
    observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
  }
  function composite() {
    finish()
    if (!state.ready || !source) throw new Error("图片尚未加载完成")
    const output = document.createElement("canvas")
    output.width = mask.width
    output.height = mask.height
    const context = output.getContext("2d")
    if (!context) throw new Error("无法创建智能重绘画布")
    context.drawImage(source, 0, 0, output.width, output.height)
    context.drawImage(mask, 0, 0, output.width, output.height)
    return output.toDataURL("image/png")
  }
  function detach() {
    finish()
    observer?.disconnect()
    canvas = undefined
  }
  createEffect(on(() => [props.source(), props.key?.()] as const, ([url]) => {
    const current = ++token
    clear()
    source = undefined
    mask.width = 0
    mask.height = 0
    setState({ ready: false, error: "", size: { width: 0, height: 0 } })
    render()
    if (!url) return
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => {
      if (current !== token) return
      if (!image.naturalWidth || !image.naturalHeight) {
        setState("error", "无法读取图片尺寸")
        return
      }
      source = image
      mask.width = image.naturalWidth
      mask.height = image.naturalHeight
      setState({ ready: true, size: { width: mask.width, height: mask.height } })
      render()
    }
    image.onerror = () => { if (current === token) setState("error", "图片加载失败") }
    image.src = url
  }))
  const blur = () => {
    finish()
    setState("cursor", "visible", false)
  }
  window.addEventListener("blur", blur)
  onCleanup(() => {
    token++
    finish()
    observer?.disconnect()
    window.removeEventListener("blur", blur)
  })
  return { state, attach, detach, down, move, up, cursor, finish, clear, undo, redo, composite, brushSize: props.brushSize }
}

export type StudioInpaintDrawing = ReturnType<typeof createStudioInpaintDrawing>

export function StudioInpaintCanvas(props: { drawing: StudioInpaintDrawing }) {
  const drawing = props.drawing
  onCleanup(drawing.detach)
  return <div class="studio-inpaint-drawing"
    on:mousedown={(event) => event.stopPropagation()}
    on:click={(event) => event.stopPropagation()}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
  >
    <canvas ref={props.drawing.attach} class="studio-inpaint-mask" aria-label="智能重绘涂抹区域"
      on:pointerdown={props.drawing.down} on:pointermove={props.drawing.move} on:pointerup={props.drawing.up}
      on:pointercancel={props.drawing.up} on:lostpointercapture={props.drawing.finish}
      on:pointerleave={(event) => props.drawing.cursor(event, false)}
    />
    <Show when={props.drawing.state.cursor.visible}>
      <span class="studio-inpaint-cursor" style={{
        left: `${props.drawing.state.cursor.x}px`, top: `${props.drawing.state.cursor.y}px`,
        width: `${props.drawing.brushSize() * props.drawing.state.cursor.scale}px`,
        height: `${props.drawing.brushSize() * props.drawing.state.cursor.scale}px`,
      }} />
    </Show>
  </div>
}
