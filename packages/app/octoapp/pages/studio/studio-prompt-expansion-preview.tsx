import { Show } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"

export function StudioPromptExpansionPreview(props: {
  part?: Extract<Part, { type: "text" }>
  status: string
}) {
  return (
    <Show when={props.status === "running" && props.part?.text.trim()}>
      <div data-component="reasoning-part" data-streaming>
        <Markdown text={props.part?.text.trim() ?? ""} cacheKey={props.part?.id} streaming={props.part?.time?.end === undefined} />
      </div>
    </Show>
  )
}
