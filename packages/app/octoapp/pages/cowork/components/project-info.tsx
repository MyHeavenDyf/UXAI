import { DialogProjectOnboarding } from "@/components/dialog-project-onboarding"
import type { ProjectSelection } from "./project-product-select-panel"
import { loadCachedSelection, saveCachedSelection } from "./project-product-select-panel"
import { createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"

const fallbackSelection: ProjectSelection = {
  directory: "",
  domain: { id: "ict", label: "ICT" },
  productLine: { id: "cann", domainId: "ict", label: "CANN" },
  product: { id: "pypto", productLineId: "cann", label: "PYPTO" },
  version: { value: "v2612304", label: "v2612304" },
}

export function ProjectInfo(): JSX.Element {
  const [visible, setVisible] = createSignal(false)
  const defaults = loadCachedSelection() ?? fallbackSelection
  const [selection, setSelection] = createSignal<ProjectSelection>(defaults)

  const productName = () => selection().product?.label ?? ""
  const domainProductLine = () => {
    const s = selection()
    const parts = []
    if (s.domain) parts.push(s.domain.label)
    if (s.productLine) parts.push(s.productLine.label)
    return parts.join("/")
  }
  const versionLabel = () => selection().version?.label ?? ""

  return (
    <>
      <div
        style={{
          background: "rgba(0,0,0,0.03)",
          "border-radius": "12px",
          padding: "8px 16px",
          "margin": "12px",
          cursor: "pointer",
        }}
        onClick={() => setVisible(true)}
      >
        <div style={{ display: "flex", "align-items": "center" }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ "flex-shrink": "0", "margin-right": "12px" }}>
            <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5" />
            <path d="M7 7H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M7 10H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M7 13H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <div style={{ flex: "1", "min-width": "0" }}>
            <div style={{ "font-size": "14px", "line-height": "22px", color: "#191919" }}>{productName()}</div>
            <div style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)" }}>{domainProductLine()}</div>
          </div>
          <div style={{ display: "flex", "align-items": "center", "flex-shrink": "0", height: "42px" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
        </div>
        <div style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)", "margin-top": "12px", "padding-left": "32px" }}>版本：{versionLabel()}</div>
      </div>
      <Show when={visible()}>
        <DialogProjectOnboarding defaults={selection()} onSelect={(data) => {
          setSelection(data)
          saveCachedSelection(data)
          setVisible(false)
        }} />
      </Show>
    </>
  )
}