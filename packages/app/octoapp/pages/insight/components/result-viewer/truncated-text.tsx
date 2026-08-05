import { createEffect, createSignal, on, onCleanup, type JSX } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export function TruncatedText(props: {
  text: string
  class?: string
  textClass?: string
  style?: JSX.CSSProperties
}) {
  const [truncated, setTruncated] = createSignal(false)
  let el: HTMLElement | undefined
  let ro: ResizeObserver | undefined
  const measure = () => {
    if (el) setTruncated(el.scrollWidth > el.clientWidth)
  }
  const setRef = (node: HTMLElement | undefined) => {
    ro?.disconnect()
    el = node
    if (!node) return
    ro = new ResizeObserver(measure)
    ro.observe(node)
  }
  createEffect(on(() => props.text, () => queueMicrotask(measure)))
  onCleanup(() => ro?.disconnect())
  return (
    <div class={props.class}>
      <Tooltip
        placement="top"
        openDelay={200}
        value={props.text}
        inactive={!truncated()}
        contentStyle={{ "white-space": "normal", "max-width": "90vw", "overflow-wrap": "anywhere" }}
      >
        <span ref={setRef} class={props.textClass} style={props.style}>
          {props.text}
        </span>
      </Tooltip>
    </div>
  )
}
