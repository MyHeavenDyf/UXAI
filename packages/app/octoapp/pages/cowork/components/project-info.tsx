import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"

export function ProjectInfo(): JSX.Element {
  const dialog = useDialog()
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.03)",
        "border-radius": "12px",
        padding: "8px 16px",
        "margin": "12px",
        cursor: "pointer",
      }}
      onClick={() => dialog.show(() => (
        <Dialog title="项目信息" fit>
          <div style={{ padding: "0 8px 8px" }}>
            <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.6)" }}>当前项目：CANN/PYPTO</div>
            <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.6)" }}>项目类型：ICT/计算</div>
            <div style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.6)" }}>当前版本：v2612304</div>
          </div>
        </Dialog>
      ))}
    >
      <div style={{ display: "flex", "align-items": "center" }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ "flex-shrink": "0", "margin-right": "12px" }}>
          <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5" />
          <path d="M7 7H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M7 10H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M7 13H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <div style={{ flex: "1", "min-width": "0" }}>
          <div style={{ "font-size": "14px", "line-height": "22px", color: "#191919" }}>CANN/PYPTO</div>
          <div style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)" }}>ICT/计算</div>
        </div>
        <div style={{ display: "flex", "align-items": "center", "flex-shrink": "0", height: "42px" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </div>
      <div style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)", "margin-top": "12px", "padding-left": "32px" }}>当前版本：v2612304</div>
    </div>
  )
}
