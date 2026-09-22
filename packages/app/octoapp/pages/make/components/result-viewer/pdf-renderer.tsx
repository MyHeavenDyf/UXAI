import type { JSX } from "solid-js"
import { resolveMediaUrl } from "./media-url"

interface Props {
  filePath: string
  refreshKey: number
}

export function PdfRenderer(props: Props): JSX.Element {
  return (
    <iframe
      src={resolveMediaUrl(props.filePath, props.refreshKey)}
      style={{ width: "100%", height: "100%", border: "none" }}
    />
  )
}
