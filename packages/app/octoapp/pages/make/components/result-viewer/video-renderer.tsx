import type { JSX } from "solid-js"

interface Props {
  filePath: string
  refreshKey: number
}

export function VideoRenderer(props: Props): JSX.Element {
  const url = `local:///${props.filePath.replace(/\\/g, '/')}?v=${props.refreshKey}`
  return (
    <div class="flex items-center justify-center h-full p-4">
      <video src={url} controls class="max-w-full max-h-full" />
    </div>
  )
}