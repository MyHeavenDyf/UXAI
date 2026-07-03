import { createSignal, onMount, onCleanup, Show, type JSX } from "solid-js"
import "../../assets/style/preview/scaledFrame.css"

export function ScaledFrame(props: {
  width: number
  height: number
  label?: string
  children: JSX.Element
}): JSX.Element {
  let viewportRef: HTMLDivElement | undefined
  const [scale, setScale] = createSignal(0)

  function recalc() {
    if (!viewportRef) return
    const cw = viewportRef.clientWidth
    const ch = viewportRef.clientHeight
    if (cw === 0 || ch === 0) return
    setScale(Math.min(cw / props.width, ch / props.height))
  }

  let ro: ResizeObserver | undefined
  onMount(() => {
    recalc()
    ro = new ResizeObserver(recalc)
    if (viewportRef) ro.observe(viewportRef)
  })
  onCleanup(() => ro?.disconnect())

  return (
    <div class="scaled-frame">
      <Show when={props.label}>
        <div class="scaled-frame-label">{props.label}</div>
      </Show>
      <div class="scaled-frame-viewport" ref={(el) => { viewportRef = el }}>
        <Show when={scale() > 0}>
          <div
            class="scaled-frame-sizer"
            style={{
              width: `${props.width * scale()}px`,
              height: `${props.height * scale()}px`,
            }}
          >
            <div
              class="scaled-frame-inner"
              style={{
                width: `${props.width}px`,
                height: `${props.height}px`,
                transform: `scale(${scale()})`,
                "transform-origin": "top left",
              }}
            >
              {props.children}
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
