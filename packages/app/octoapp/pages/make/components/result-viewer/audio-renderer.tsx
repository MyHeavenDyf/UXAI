import type { JSX } from "solid-js"
import { createSignal, createEffect, Show } from "solid-js"
import { resolveMediaUrl } from "./media-url"

interface Props {
  filePath: string
  refreshKey: number
}

export function AudioRenderer(props: Props): JSX.Element {
  const [errored, setErrored] = createSignal(false)
  createEffect(() => { props.refreshKey; setErrored(false) })
  return (
    <div class="flex items-center justify-center h-full p-4">
      <Show when={!errored()} fallback={
        <div class="flex items-center gap-2">
          <span class="i-svg-spinners-clock size-5" />
          <span style={{ color: "var(--octo-text-secondary)", "font-size": "14px" }}>音频加载中...</span>
        </div>
      }>
        <audio
          src={resolveMediaUrl(props.filePath, props.refreshKey)}
          controls
          class="w-full max-w-md"
          onError={() => setErrored(true)}
        />
      </Show>
    </div>
  )
}
