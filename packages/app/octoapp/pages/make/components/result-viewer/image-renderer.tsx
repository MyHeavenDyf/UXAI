import type { JSX } from "solid-js"
import { resolveMediaUrl } from "./media-url"

interface Props {
  filePath: string
  refreshKey: number
}

export function ImageRenderer(props: Props): JSX.Element {
  const url = resolveMediaUrl(props.filePath, props.refreshKey)
  return (
    <div class="flex items-center justify-center h-full overflow-auto p-4">
      <img src={url} alt="preview" class="max-w-full max-h-full object-contain" />
    </div>
  )
}