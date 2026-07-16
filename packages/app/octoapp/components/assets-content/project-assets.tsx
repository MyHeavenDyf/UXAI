import { useProjectSelection } from "@/hooks/use-project-selection"
import { Show, type JSX } from "solid-js"

export function ProjectAssets(): JSX.Element {
  const selection = useProjectSelection()
  const embedUrl = () => `${import.meta.env.VITE_OCTO_BASE_URL}/agentPage/asset-repository/${selection()?.product?.id ?? ""}`

  return (
    <Show when={selection()?.product} fallback={<div style={{ padding: "24px", "text-align": "center", color: "rgba(0,0,0,0.4)" }}>请先选择产品</div>}>
      <iframe
        src={embedUrl()}
        class="w-full h-full"
        style={{ border: "none", "min-height": "400px" }}
      />
    </Show>
  )
}
