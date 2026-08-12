import { createSignal, onMount, type JSX } from "solid-js"
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

  const BODY_PREFIX = `确定删除"`
  const BODY_SUFFIX = `"?`
  const [bodyText, setBodyText] = createSignal(BODY_PREFIX + props.name + BODY_SUFFIX)
  let bodyRef: HTMLDivElement | undefined

  onMount(() => {
    requestAnimationFrame(() => {
      if (!bodyRef) return
      const maxHeight = 44
      const name = props.name
      const tryFit = (text: string) => {
        bodyRef!.textContent = text
        return bodyRef!.scrollHeight <= maxHeight
      }
      const fullText = BODY_PREFIX + name + BODY_SUFFIX
      if (tryFit(fullText)) {
        setBodyText(fullText)
        return
      }
      let lo = 0, hi = name.length, answer = 0
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (tryFit(BODY_PREFIX + name.slice(0, mid) + "..." + BODY_SUFFIX)) {
          answer = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      setBodyText(BODY_PREFIX + name.slice(0, answer) + "..." + BODY_SUFFIX)
    })
  })

  return (
    <Dialog
      fit
      class="delete-dialog"
      style={{
        "background-color": "rgba(255, 255, 255, 0.9)",
        "backdrop-filter": "blur(16px)",
      }}
    >
      <div style={{ display: "flex", gap: "8px", "align-items": "flex-start", "margin-bottom": "16px" }}>
        <Icon name="info-circle" style={{ width: "20px", height: "20px", "flex-shrink": "0", "margin-top": "2px" }} />
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "min-width": "0", flex: "1" }}>
          <span style={{ "font-size": "16px", "line-height": "24px", color: "rgba(0,0,0,0.9)" }}>
            确定要删除该对话吗？
          </span>
          <div
            ref={(el) => (bodyRef = el)}
            style={{
              "font-size": "14px",
              "line-height": "22px",
              color: "rgba(0,0,0,0.9)",
              "word-break": "break-all",
              "max-height": "44px",
              overflow: "hidden",
            }}
          >
            {bodyText()}
          </div>
        </div>
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
