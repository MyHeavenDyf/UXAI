import { createMemo, createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { buildSrcdoc } from "../../utils/srcdoc-builder"
import { PreviewOverlay } from "../preview-overlay"

export type PaletteId = "coral" | "electric" | "acid-forest" | "risograph" | "mono-noir"

export type ViewportPreset = "desktop" | "tablet" | "mobile"

export const PALETTE_PRESETS: { id: PaletteId; label: string; colors: string[] }[] = [
  { id: "coral", label: "Coral", colors: ["#ff5a3c", "#ff7a5c", "#fde2d6"] },
  { id: "electric", label: "Electric", colors: ["#7c3aed", "#a855f7", "#e9d5ff"] },
  { id: "acid-forest", label: "Acid Forest", colors: ["#16a34a", "#22c55e", "#bbf7d0"] },
  { id: "risograph", label: "Risograph", colors: ["#e11d48", "#2563eb", "#fde68a"] },
  { id: "mono-noir", label: "Mono Noir", colors: ["#0a0a0a", "#262626", "#e5e5e5"] },
]

const VIEWPORT_DIMS: Record<ViewportPreset, { width: number | null; height: number | null }> = {
  desktop: { width: null, height: null },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
}

function extractHtmlContent(text: string): string {
  const re = /```html\s*\n([\s\S]*?)\n?```/i
  const m = text.match(re)
  if (m) return m[1].trim()
  if (/<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text)) return text.trim()
  return text.trim()
}

function effectiveScale(
  preset: ViewportPreset,
  canvasW: number,
  canvasH: number,
): number {
  const dims = VIEWPORT_DIMS[preset]
  if (!dims.width || !dims.height) return 1
  const pad = 48
  const availW = Math.max(1, canvasW - pad)
  const availH = Math.max(1, canvasH - pad)
  return Math.min(1, availW / dims.width, availH / dims.height)
}

export function HtmlRenderer(props: {
  content: string
  mode: "preview" | "edit"
  viewport?: ViewportPreset
  palette?: PaletteId | null
  inspecting?: boolean
  onContentChange?: (content: string) => void
}): JSX.Element {
  let iframeRef: HTMLIFrameElement | undefined

  const srcdoc = createMemo(() =>
    buildSrcdoc(extractHtmlContent(props.content), {
      focusGuard: true,
      palette: !!props.palette,
      initialPalette: props.palette ?? null,
      picker: true,
    })
  )

  // Send palette change via postMessage (avoids full re-render)
  const sendPalette = (id: PaletteId | null) => {
    iframeRef?.contentWindow?.postMessage({ type: "od:palette", palette: id }, "*")
  }

  // Sync palette on prop change
  createEffect(() => {
    if (props.mode === "preview" && iframeRef) {
      sendPalette(props.palette ?? null)
    }
  })

  const [canvasSize, setCanvasSize] = createSignal({ w: 0, h: 0 })
  let containerRef: HTMLDivElement | undefined

  const observer = new ResizeObserver((entries) => {
    const e = entries[0]
    if (e) setCanvasSize({ w: e.contentRect.width, h: e.contentRect.height })
  })

  onMount(() => {
    if (containerRef) observer.observe(containerRef)
  })
  onCleanup(() => observer.disconnect())

  const isResponsive = () => {
    const vp = props.viewport ?? "desktop"
    return vp !== "desktop" && props.mode === "preview"
  }

  const containerStyle = createMemo(() => {
    if (!isResponsive()) return {}

    const vp = props.viewport!
    const dims = VIEWPORT_DIMS[vp]
    const { w, h } = canvasSize()
    const scale = effectiveScale(vp, w, h)
    const pad = 24

    return {
      "--octo-vp-width": `${dims.width}px`,
      "--octo-vp-height": `${dims.height}px`,
      "--octo-vp-scale": scale,
      "--octo-vp-offset-x": `${pad + Math.max(0, (w - pad * 2 - dims.width! * scale) / 2)}px`,
      "--octo-vp-offset-y": `${pad}px`,
    } as JSX.CSSProperties
  })

  const frameStyle = createMemo(() => {
    if (!isResponsive()) return {}
    const vp = props.viewport!
    const dims = VIEWPORT_DIMS[vp]
    return {
      width: `${dims.width}px`,
      height: `${dims.height}px`,
      transform: `scale(var(--octo-vp-scale, 1))`,
      "transform-origin": "0 0",
    } as JSX.CSSProperties
  })

  return (
    <div
      ref={containerRef}
      class="h-full w-full overflow-auto"
      style={{ background: isResponsive() ? "var(--octo-shell-bg, #F3F6FB)" : "white", position: "relative", ...containerStyle() }}
    >
      {props.mode === "preview" ? (
        <>
          {isResponsive() ? (
            <div
              class="octo-viewport-frame"
              style={{
                ...frameStyle(),
                background: "white",
                "border-radius": "var(--octo-radius-lg, 8px)",
                "box-shadow": "var(--octo-shadow-md, 0 4px 16px rgba(0,0,0,0.08))",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <iframe
                ref={iframeRef}
                srcdoc={srcdoc()}
                sandbox="allow-scripts"
                style={{
                  width: `${VIEWPORT_DIMS[props.viewport!].width}px`,
                  height: `${VIEWPORT_DIMS[props.viewport!].height}px`,
                  border: "none",
                }}
              />
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              srcdoc={srcdoc()}
              sandbox="allow-scripts"
              class="w-full h-full border-0"
              style={{ "min-height": "200px" }}
            />
          )}
          <Show when={props.inspecting}>
            <PreviewOverlay iframeRef={iframeRef} inspecting={!!props.inspecting} />
          </Show>
        </>
      ) : (
        <textarea
          value={extractHtmlContent(props.content)}
          onInput={(e) => props.onContentChange?.(e.currentTarget.value)}
          class="w-full h-full resize-none p-4 text-sm font-mono outline-none"
          style={{
            background: "rgba(243,244,246,1)",
            color: "var(--octo-text-primary)",
            "tab-size": 2,
          }}
          spellcheck={false}
        />
      )}
    </div>
  )
}
