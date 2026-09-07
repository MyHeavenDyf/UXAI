import type { JSX } from "solid-js"

interface Props {
  filePath?: string
  uri?: string
  refreshKey?: number
}

export function ImageRenderer(props: Props): JSX.Element {
  const url = () => {
    if (props.filePath) {
      const base = `local:///${props.filePath.replace(/\\/g, "/")}`
      return props.refreshKey ? `${base}?v=${props.refreshKey}` : base
    }
    return props.uri ?? ""
  }
  return (
    <div class="flex items-center justify-center h-full overflow-auto p-4" style={{ background: "var(--octo-surface-result)" }}>
      <img src={url()} alt="preview" class="max-w-full max-h-full object-contain" />
    </div>
  )
}
