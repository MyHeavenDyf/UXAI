import { For, Show } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"

export function StudioPromptExpansionReasoning(props: {
  parts: Extract<Part, { type: "reasoning" }>[]
  status: string
}) {
  const parts = () => props.parts.filter((part) => part.text.trim())
  return (
    <Show when={props.status === "running" && parts().length > 0}>
      <div data-component="reasoning-part" data-streaming>
        <For each={parts()}>
          {(part) => <Markdown text={part.text.trim()} cacheKey={part.id} streaming={part.time.end === undefined} />}
        </For>
      </div>
    </Show>
  )
}
