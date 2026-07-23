import { useProjectSelection } from "@/hooks/use-project-selection"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"

export function ProjectAssets(): JSX.Element {
  const selection = useProjectSelection()
  const embedUrl = () => `${import.meta.env.VITE_OCTO_BASE_URL}/agentPage/asset-repository/${selection()?.product?.id ?? ""}`

  const [modalOpen, setModalOpen] = createSignal(false)
  let iframeRef: HTMLIFrameElement | undefined

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef?.contentWindow) return
      if (event.data?.type === "modalStateChange") setModalOpen(!!event.data.isOpen)
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  return (
    <Show when={selection()?.product} fallback={<div style={{ padding: "24px", "text-align": "center", color: "rgba(0,0,0,0.4)" }}>请先选择产品</div>}>
      <iframe
        ref={(el) => (iframeRef = el)}
        src={embedUrl()}
        class="w-full h-full"
        style={{
          border: "none",
          "min-height": "400px",
          background: "#fff",
          position: "relative",
          "z-index": modalOpen() ? 51 : "auto",
        }}
      />
      <Show when={modalOpen()}>
        <Portal mount={document.body}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", "z-index": 50 }} />
        </Portal>
      </Show>
    </Show>
  )
}
