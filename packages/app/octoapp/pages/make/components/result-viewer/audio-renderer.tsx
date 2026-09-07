import type { JSX } from "solid-js"

interface Props {
  filePath: string
  refreshKey: number
}

export function AudioRenderer(props: Props): JSX.Element {
  const url = `local:///${props.filePath.replace(/\\/g, '/')}?v=${props.refreshKey}`
  return (
    <div class="flex items-center justify-center h-full p-4">
      <audio src={url} controls class="w-full max-w-md" />
    </div>
  )
}