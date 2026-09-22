import type { JSX } from "solid-js"
import { resolveMediaUrl } from "./media-url"

interface Props {
  filePath: string
  refreshKey: number
}

export function PdfRenderer(props: Props): JSX.Element {
  const url = resolveMediaUrl(props.filePath, props.refreshKey)
  return (
    <iframe src={url} style={{ width: "100%", height: "100%", border: "none" }} />
  )
}