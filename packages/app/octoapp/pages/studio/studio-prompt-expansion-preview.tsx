import { createEffect, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"

export function StudioPromptExpansionPreview(props: {
  part?: Extract<Part, { type: "text" }>
  status: string
}) {
  const [shown, setShown] = createStore({ id: "", text: "" })
  let timer: ReturnType<typeof setTimeout> | undefined
  const target = () => props.part?.text.trim() ?? ""
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const advance = () => {
    timer = undefined
    if (props.status !== "running" || props.part?.id !== shown.id) return
    const remaining = [...target().slice(shown.text.length)]
    const size = remaining.length <= 12 ? 2 : remaining.length <= 48 ? 4
      : remaining.length <= 96 ? 8 : Math.min(24, Math.ceil(remaining.length / 8))
    setShown("text", shown.text + remaining.slice(0, size).join(""))
    if (shown.text.length < target().length) timer = setTimeout(advance, 24)
  }
  createEffect(on(
    () => [props.part?.id, props.status, target()] as const,
    ([id, status, text]) => {
      if (status !== "running" || !text) {
        clear()
        setShown({ id: id ?? "", text: "" })
        return
      }
      if (id !== shown.id || !text.startsWith(shown.text)) {
        clear()
        setShown({ id: id ?? "", text: "" })
      }
      if (shown.text.length < text.length && timer === undefined) timer = setTimeout(advance, 24)
    },
  ))
  onCleanup(clear)

  return (
    <Show when={props.status === "running" && props.part?.text.trim()}>
      <div data-component="reasoning-part" data-streaming>
        <Markdown
          text={shown.text}
          cacheKey={props.part?.id}
          streaming={shown.text !== target() || props.part?.time?.end === undefined}
        />
      </div>
    </Show>
  )
}
