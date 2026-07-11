import type { JSX } from "solid-js"

const EMBED_URL = "about:blank"

export function ProjectAssets(): JSX.Element {
  return (
    <iframe
      src={EMBED_URL}
      class="w-full h-full"
      style={{ border: "none", "min-height": "400px" }}
    />
  )
}
