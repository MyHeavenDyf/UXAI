import { useProjectSelection } from "@/hooks/use-project-selection"
import { createSignal, onCleanup, onMount, Show, For, type JSX } from "solid-js"
import { Portal } from "solid-js/web"

export function ProductAssets(): JSX.Element {
  const selection = useProjectSelection()
  const embedUrl = () => {
    const base = import.meta.env.VITE_OCTO_BASE_URL
    if (!base) return ""
    const time = new Date().getTime();
    return `${base}/agentPage/asset-repository/${selection()?.product?.id ?? ""}?ts=${time}`
  }

  const [modalNum, setModalNum] = createSignal(0)
  let iframeRef: HTMLIFrameElement | undefined

  onMount(() => {
    const base = import.meta.env.VITE_OCTO_BASE_URL
    const allowedOrigin = base ? new URL(base).origin : ""
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef?.contentWindow) return
      if (allowedOrigin && event.origin !== allowedOrigin) return
      // modalNum 为当前打开的弹窗个数;可能同时存在多个弹窗
      if (event.data?.type === "modalStateChange") setModalNum(event.data.modalNum ?? 0)
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  return (
    <Show when={selection()?.product && embedUrl()} fallback={<div style={{ padding: "24px", "text-align": "center", color: "var(--octo-text-secondary)" }}>请先选择产品</div>}>
      <iframe
        ref={(el) => (iframeRef = el)}
        src={embedUrl()}
        class="w-full h-full"
        style={{
          border: "none",
          background: "var(--octo-surface-page)",
          position: "relative",
          "z-index": modalNum() > 0 ? 51 : "auto",
        }}
      />
      <Show when={modalNum() > 0}>
        <Portal mount={document.body}>
          {/* 弹窗个数与蒙层个数一一对应:每多开一个弹窗叠加一层蒙层 */}
          <For each={Array.from({ length: modalNum() }, (_, i) => i)}>
            {() => <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", "z-index": 50 }} />}
          </For>
        </Portal>
      </Show>
    </Show>
  )
}
