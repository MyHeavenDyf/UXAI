import type { JSX } from "solid-js"

interface Props {
  filePath: string
  refreshKey: number
}

export function PdfRenderer(props: Props): JSX.Element {
  const url = `local:///${props.filePath.replace(/\\/g, '/')}?v=${props.refreshKey}`
  return (
    <iframe src={url} style={{ width: "100%", height: "100%", border: "none" }} />
  )
}