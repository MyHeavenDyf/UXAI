import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Root as TabsRoot, List as TabsList, Trigger as TabsTrigger, Content as TabsContent } from "@kobalte/core/tabs"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { SettingsGeneral } from "./settings-general"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"

// ── Dialog drag-to-move support ──
// The settings dialog is a centered modal portaled to document.body. There is no
// built-in move logic, so we translate the [data-slot="dialog-container"] box by
// dragging a dedicated title bar. Each open creates a fresh DOM node, so the
// position naturally resets between opens.
const DRAG_MARGIN = 8

interface DragState {
  startX: number
  startY: number
  baseX: number
  baseY: number
  container: HTMLElement
  rect: DOMRect
}

let drag: DragState | null = null

function readTranslate(el: HTMLElement): [number, number] {
  const m = el.style.transform.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/)
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]
}

function clamp(v: number, min: number, max: number) {
  if (min > max) return v
  return Math.min(Math.max(v, min), max)
}

function onDragMove(e: PointerEvent) {
  if (!drag) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxLeft = vw - drag.rect.width - DRAG_MARGIN
  const maxTop = vh - drag.rect.height - DRAG_MARGIN
  const cx = maxLeft > DRAG_MARGIN ? clamp(dx, DRAG_MARGIN - drag.rect.left, maxLeft - drag.rect.left) : dx
  const cy = maxTop > DRAG_MARGIN ? clamp(dy, DRAG_MARGIN - drag.rect.top, maxTop - drag.rect.top) : dy
  drag.container.style.transform = `translate(${drag.baseX + cx}px, ${drag.baseY + cy}px)`
}

function endDrag() {
  if (!drag) return
  drag.container.style.transition = ""
  document.body.style.cursor = ""
  document.body.style.userSelect = ""
  drag = null
  window.removeEventListener("pointermove", onDragMove)
  window.removeEventListener("pointerup", endDrag)
  window.removeEventListener("pointercancel", endDrag)
}

function startDrag(e: PointerEvent) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement | null
  // Don't start a drag when pressing on an interactive element (close button, etc.)
  if (target?.closest("button, a, input, textarea, select, [role='button']")) return
  const handle = e.currentTarget as HTMLElement
  const container = handle.closest<HTMLElement>("[data-slot='dialog-container']")
  if (!container) return
  const rect = container.getBoundingClientRect()
  const [tx, ty] = readTranslate(container)
  drag = { startX: e.clientX, startY: e.clientY, baseX: tx, baseY: ty, container, rect }
  container.style.transition = "none"
  document.body.style.cursor = "default"
  document.body.style.userSelect = "none"
  window.addEventListener("pointermove", onDragMove)
  window.addEventListener("pointerup", endDrag)
  window.addEventListener("pointercancel", endDrag)
  e.preventDefault()
}
// jk-j60099994-replace-with-dialog-settings-1-start
// jk-j60099994-replace-with-dialog-settings-1-end


const sectionTitle: Record<string, string> = {
  "font-size": "14px",
  "font-weight": "bold",
  "line-height": "22px",
  padding: "12px 16px",
  color: "rgba(0, 0, 0, 0.9)",
}

const triggerStyle: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  gap: "12px",
  width: "100%",
  padding: "12px 16px",
  "font-size": "14px",
  "line-height": "22px",
  cursor: "pointer",
  border: "none",
  background: "none",
  color: "rgba(0, 0, 0, 0.9)",
  "border-radius": "8px",
  "box-sizing": "border-box",
  outline: "none",
  position: "relative",
}

const iconBase: Record<string, string> = {
  width: "20px",
  height: "20px",
  "flex-shrink": "0",
  "background-color": "currentColor",
  "mask-size": "20px 20px",
  "mask-repeat": "no-repeat",
  "mask-position": "center",
  "-webkit-mask-size": "20px 20px",
  "-webkit-mask-repeat": "no-repeat",
  "-webkit-mask-position": "center",
}

export const DialogSettings: Component<{ initialTab?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()

  return (
    <Dialog size="x-large" transition class="settings-dialog">
      <div
        data-settings-dialog
        style={{ display: "flex", "flex-direction": "column", flex: "0 1 auto", "min-height": "0" }}
      >
        <style>{`
          
          .settings-dialog {
            border-radius: 20px !important;
            box-shadow: 0 16px 48px 0 rgba(0, 0, 0, 0.16) !important;
            background: #fff !important;
          }
          [data-slot="dialog-container"]:has(.settings-dialog) {
            height: min(calc(100vh - 32px), 644px) !important;
          }
          [data-settings-dialog] button[aria-selected="true"] {
            background-color: rgba(10, 89, 247, 0.08) !important;
            color: #0a59f7 !important;
            border-radius: 8px !important;
          }
          [data-settings-dialog] button[aria-selected="true"]::after {
            content: "";
            position: absolute;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            width: 4px;
            height: 32px;
            border-radius: 999px;
            background: #0a59f7;
          }
          [data-settings-dialog] [data-slot="switch-control"] {
            width: 38px !important;
            height: 20px !important;
            border-radius: 999px !important;
            background: #c2c2c2 !important;
            border: none !important;
          }
          [data-settings-dialog] [data-slot="switch-thumb"] {
            width: 16px !important;
            height: 16px !important;
            border-radius: 999px !important;
            background: #fff !important;
            box-shadow: 0 0 4px 0 rgba(0, 0, 0, 0.4) !important;
            border: none !important;
            transform: translateX(2px) !important;
          }
          [data-settings-dialog] [data-checked] [data-slot="switch-control"] {
            background: #0a59f7 !important;
            border: none !important;
          }
          [data-settings-dialog] [data-checked] [data-slot="switch-thumb"] {
            transform: translateX(20px) !important;
            border: none !important;
          }
          [data-settings-models] {
            scrollbar-color: rgba(0, 0, 0, 0.24) transparent;
            scrollbar-gutter: stable;
            scrollbar-width: thin;
          }
          [data-settings-models]::-webkit-scrollbar {
            width: 6px;
          }
          [data-settings-models]::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.24);
            border-radius: 999px;
          }
        `}</style>
        {/* Draggable title bar — press and drag to move the dialog */}
        <div
          class="settings-drag-handle"
          onPointerDown={startDrag}
          onDblClick={() => {
            const el = document.querySelector<HTMLElement>("[data-slot='dialog-container']")
            if (el) el.style.transform = ""
          }}
          style={{
            "flex-shrink": "0",
            height: "44px",
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "0 8px 0 16px",
            cursor: "default",
            "user-select": "none",
            "touch-action": "none",
            "border-bottom": "1px solid rgba(0, 0, 0, 0.06)",
          }}
        >
          <span style={{ "font-size": "14px", "line-height": "22px", "font-weight": 600, color: "rgba(0, 0, 0, 0.9)" }}>
            {language.t("sidebar.settings")}
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => dialog.close()}
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              width: "28px",
              height: "28px",
              border: "none",
              background: "transparent",
              "border-radius": "6px",
              cursor: "pointer",
              color: "rgba(0, 0, 0, 0.6)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.06)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <TabsRoot orientation="vertical" defaultValue={props.initialTab ?? "general"} style={{ display: "flex", flex: "0 1 auto", "min-height": "0" }}>
          <TabsList
            style={{
              width: "240px",
              background: "#fff",
              padding: "8px 16px 24px",
              display: "flex",
              "flex-direction": "column",
              "justify-content": "space-between",
              "flex-shrink": 0,
              "border-right": "1px solid rgba(0, 0, 0, 0.1)",
              gap: "0",
              "overflow-y": "auto",
              outline: "none",
            }}
          >
            <div>
              <div style={sectionTitle}>{language.t("settings.section.desktop")}</div>
              <TabsTrigger value="general" style={triggerStyle}>
                <div
                  style={{
                    ...iconBase,
                    "mask-image": "url(/setting/generalIcon.svg)",
                    "-webkit-mask-image": "url(/setting/generalIcon.svg)",
                  }}
                />
                {language.t("settings.tab.general")}
              </TabsTrigger>

              <div style={sectionTitle}>{language.t("settings.section.server")}</div>
              <TabsTrigger value="providers" style={triggerStyle}>
                <div
                  style={{
                    ...iconBase,
                    "mask-image": "url(/setting/providerIcon.svg)",
                    "-webkit-mask-image": "url(/setting/providerIcon.svg)",
                  }}
                />
                {language.t("settings.providers.title")}
              </TabsTrigger>
              <TabsTrigger value="models" style={triggerStyle}>
                <div
                  style={{
                    ...iconBase,
                    "mask-image": "url(/setting/modeIcon.svg)",
                    "-webkit-mask-image": "url(/setting/modeIcon.svg)",
                  }}
                />
                {language.t("settings.models.title")}
              </TabsTrigger>
            </div>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                gap: "12px",
                padding: "0",
                "margin-top": "24px"
              }}
            >
              <img src="/setting/OctoAgentLogo.png" width={114} height={28} alt="" />
              {/* jk-j60099994-replace-with-dialog-settings-2-start */}
              <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)" }}>v1.14.41</span>
              {/* jk-j60099994-replace-with-dialog-settings-2-end */}
            </div>
          </TabsList>
          <TabsContent value="general" style={{ flex: 1, overflow: "auto", padding: "8px 20px" }}>
            <SettingsGeneral />
          </TabsContent>
          <TabsContent value="providers" style={{ flex: 1, overflow: "auto", padding: "8px 20px" }}>
            <SettingsProviders />
          </TabsContent>
          <TabsContent
            value="models"
            style={{ flex: 1, "min-height": 0, "min-width": 0, overflow: "hidden", padding: "8px 20px" }}
          >
            <SettingsModels />
          </TabsContent>
        </TabsRoot>
      </div>
    </Dialog>
  )
}
