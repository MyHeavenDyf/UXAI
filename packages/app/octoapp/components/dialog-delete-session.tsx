import type { JSX } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export function DialogDeleteSession(props: { name: string; onDelete: () => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()

  const buttonBase: JSX.CSSProperties = {
    "font-size": "14px",
    "line-height": "22px",
    height: "32px",
    padding: "0 16px",
    "min-width": "88px",
    "border-radius": "4px",
    cursor: "pointer",
    border: "1px solid rgba(0,0,0,0.1)",
    "font-family": "var(--font-family-sans)",
  }

  const whiteButton: JSX.CSSProperties = {
    ...buttonBase,
    "background-color": "#fff",
    color: "#191919",
  }

  const blueButton: JSX.CSSProperties = {
    ...buttonBase,
    "background-color": "#0a59f7",
    color: "#fff",
    border: "none",
  }

  return (
    <Dialog
      fit
      class="delete-dialog"
      style={{
        "background-color": "rgba(255, 255, 255, 0.9)",
        "backdrop-filter": "blur(16px)",
      }}
    >
      <div class="flex items-center gap-2" style={{ "margin-bottom": "16px" }}>
        <Icon name="info-circle" style={{ width: "20px", height: "20px" }} />
        <span
          style={{ "font-size": "20px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}
        >
          确定要删除该对话吗？
        </span>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button
          type="button"
          style={whiteButton}
          onClick={() => dialog.close()}
          onMouseEnter={(e) => {
            e.currentTarget.style.setProperty("border-color", "#191919")
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.setProperty("border-color", "rgba(0,0,0,0.1)")
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.setProperty("border-color", "#0a59f7")
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.setProperty("border-color", "#191919")
          }}
        >
          {language.t("common.cancel")}
        </button>
        <button
          type="button"
          style={blueButton}
          onClick={() => void props.onDelete().then(() => dialog.close())}
          onMouseEnter={(e) => {
            e.currentTarget.style.setProperty("background-color", "#0950de")
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.setProperty("background-color", "#0a59f7")
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.setProperty("background-color", "#0a55eb")
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.setProperty("background-color", "#0950de")
          }}
        >
          {language.t("session.delete.button")}
        </button>
      </div>
    </Dialog>
  )
}
