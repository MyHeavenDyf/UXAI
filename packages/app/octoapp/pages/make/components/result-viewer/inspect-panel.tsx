import { createSignal, createEffect, Show, type JSX } from "solid-js"
import type { InspectTarget } from "./html-renderer"

export function InspectPanel(props: {
  target: InspectTarget | null
  onApplyStyle: (elementId: string, prop: string, value: string) => void
  onResetElement: (elementId: string) => void
  onSaveToContent: () => void
  onClose: () => void
  iframeRef: HTMLIFrameElement | undefined
}): JSX.Element {
  const [draft, setDraft] = createSignal<Record<string, string>>({})

  // Reset draft when target changes
  createEffect(() => {
    if (props.target) setDraft({})
  })

  const value = (prop: string, fallback: string): string =>
    draft()[prop] ?? fallback

  function setVal(prop: string, raw: string) {
    setDraft((d) => ({ ...d, [prop]: raw }))
    if (props.target?.elementId) {
      props.onApplyStyle(props.target.elementId, prop, raw)
    }
  }

  function pxToNumber(s: string): number {
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : 0
  }

  function rgbToHex(rgb: string): string {
    const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (!m) return "#000000"
    const r = parseInt(m[1]).toString(16).padStart(2, "0")
    const g = parseInt(m[2]).toString(16).padStart(2, "0")
    const b = parseInt(m[3]).toString(16).padStart(2, "0")
    return `#${r}${g}${b}`
  }

  const target = () => props.target
  if (!target()) return null

  const style = () => target()?.style ?? {}
  const initialPadding = pxToNumber(style().paddingTop ?? "0")
  const initialFontSize = pxToNumber(style().fontSize ?? "16")
  const initialRadius = pxToNumber(style().borderRadius ?? "0")

  const colorHex = () => value("color", rgbToHex(style().color ?? "#000000"))
  const bgHex = () => value("backgroundColor", rgbToHex(style().backgroundColor ?? "#ffffff"))
  const padding = () => value("padding", String(initialPadding))
  const fontSize = () => value("fontSize", String(initialFontSize))
  const radius = () => value("borderRadius", String(initialRadius))
  const textAlign = () => value("textAlign", style().textAlign ?? "left")
  const fontWeight = () => value("fontWeight", style().fontWeight ?? "400")

  const paddingNum = () => pxToNumber(padding())
  const fontSizeNum = () => pxToNumber(fontSize())
  const radiusNum = () => pxToNumber(radius())

  return (
    <aside class="inspect-panel">
      <header class="inspect-panel-head">
        <div class="inspect-panel-title">
          <strong title={target()?.tag ?? ""}>
            {target()?.tag ?? "Element"}
          </strong>
          <code title={target()?.selector ?? ""}>
            {target()?.elementId ?? target()?.selector ?? ""}
          </code>
        </div>
        <button
          type="button"
          class="ghost"
          onClick={() => props.onClose()}
          aria-label="Close inspect"
        >
          ×
        </button>
      </header>

      <section class="inspect-section">
        <div class="inspect-section-label">Colors</div>
        <div class="inspect-row">
          <label for="ip-color">Text</label>
          <input
            id="ip-color"
            type="color"
            value={colorHex()}
            onChange={(e) => setVal("color", e.currentTarget.value)}
          />
          <input
            type="text"
            value={colorHex()}
            onChange={(e) => setVal("color", e.currentTarget.value)}
            spellcheck={false}
          />
        </div>
        <div class="inspect-row">
          <label for="ip-bg">Background</label>
          <input
            id="ip-bg"
            type="color"
            value={bgHex()}
            onChange={(e) => setVal("backgroundColor", e.currentTarget.value)}
          />
          <input
            type="text"
            value={bgHex()}
            onChange={(e) => setVal("backgroundColor", e.currentTarget.value)}
            spellcheck={false}
          />
        </div>
      </section>

      <section class="inspect-section">
        <div class="inspect-section-label">Typography</div>
        <div class="inspect-row">
          <label for="ip-fs">Size</label>
          <input
            id="ip-fs"
            type="range"
            min={8}
            max={160}
            step={1}
            value={Math.max(8, Math.min(160, fontSizeNum()))}
            onChange={(e) => setVal("fontSize", `${e.currentTarget.value}px`)}
          />
          <span class="inspect-row-value">{Math.round(fontSizeNum())}px</span>
        </div>
        <div class="inspect-row">
          <label for="ip-fw">Weight</label>
          <select
            id="ip-fw"
            value={fontWeight()}
            onChange={(e) => setVal("fontWeight", e.currentTarget.value)}
          >
            {["100", "300", "400", "500", "600", "700", "800", "900"].map((w) => (
              <option value={w}>{w}</option>
            ))}
          </select>
        </div>
        <div class="inspect-row">
          <label for="ip-ta">Align</label>
          <select
            id="ip-ta"
            value={textAlign()}
            onChange={(e) => setVal("textAlign", e.currentTarget.value)}
          >
            {["left", "center", "right", "justify"].map((a) => (
              <option value={a}>{a}</option>
            ))}
          </select>
        </div>
      </section>

      <section class="inspect-section">
        <div class="inspect-section-label">Spacing &amp; Shape</div>
        <div class="inspect-row">
          <label for="ip-pad">Padding</label>
          <input
            id="ip-pad"
            type="range"
            min={0}
            max={120}
            step={1}
            value={Math.max(0, Math.min(120, paddingNum()))}
            onChange={(e) => setVal("padding", `${e.currentTarget.value}px`)}
          />
          <span class="inspect-row-value">{Math.round(paddingNum())}px</span>
        </div>
        <div class="inspect-row">
          <label for="ip-rad">Radius</label>
          <input
            id="ip-rad"
            type="range"
            min={0}
            max={120}
            step={1}
            value={Math.max(0, Math.min(120, radiusNum()))}
            onChange={(e) => setVal("borderRadius", `${e.currentTarget.value}px`)}
          />
          <span class="inspect-row-value">{Math.round(radiusNum())}px</span>
        </div>
      </section>

      <div class="inspect-actions">
        <button
          type="button"
          class="inspect-reset-btn"
          onClick={() => {
            if (props.target?.elementId) {
              props.onResetElement(props.target.elementId)
            }
          }}
        >
          Reset
        </button>
        <button
          type="button"
          class="inspect-save-btn"
          onClick={() => props.onSaveToContent()}
        >
          Save to HTML
        </button>
      </div>
    </aside>
  )
}