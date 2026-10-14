import type { JSX } from "solid-js"
import { createSignal, createEffect, Show } from "solid-js"
import { resolveMediaUrl } from "./media-url"

interface Props {
  filePath: string
  refreshKey: number
}

export function ImageRenderer(props: Props): JSX.Element {
  const [errored, setErrored] = createSignal(false)
  createEffect(() => { props.refreshKey; setErrored(false) })
  return (
    <div class="flex items-center justify-center h-full overflow-auto p-4">
      <Show when={!errored()} fallback={
        <div class="flex items-center gap-2">
          <span class="i-svg-spinners-clock size-5" />
          <span style={{ color: "var(--octo-text-secondary)", "font-size": "14px" }}>图片加载中...</span>
        </div>
      }>
        <img
          src={resolveMediaUrl(props.filePath, props.refreshKey)}
          alt="preview"
          class="max-w-full max-h-full object-contain"
          onError={() => setErrored(true)}
        />
      </Show>
    </div>
  )
}
