import type { JSX } from "solid-js"
import { Show, For } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"

function WarningIcon() {
  return (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none">
      <path
        d="M8 0C3.5816 0 0 3.5816 0 8C0 12.4184 3.5816 16 8 16C12.4184 16 16 12.4184 16 8C16 3.5816 12.4184 0 8 0ZM7.42857 10.3334C7.42857 10.6534 7.68 10.9048 8 10.9048C8.32 10.9048 8.57143 10.6534 8.57143 10.3334L8.57143 4.00004C8.57143 3.68004 8.32 3.42861 8 3.42861C7.68 3.42861 7.42857 3.68004 7.42857 4.00004L7.42857 10.3334ZM7.33333 12.1666C7.33333 11.7985 7.63181 11.5 8 11.5C8.36819 11.5 8.66667 11.7985 8.66667 12.1666C8.66667 12.5348 8.36819 12.8333 8 12.8333C7.63181 12.8333 7.33333 12.5348 7.33333 12.1666Z"
        fill="#FCC800"
        fill-rule="evenodd"
      />
    </svg>
  )
}

export interface PermissionDialogProps {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  /** 自定义描述文本，覆盖默认的 toolDescription */
  hint?: string
  /** 点击某条路径时触发(通常打开对应本地文件);缺省则路径不可点。 */
  onOpenPath?: (pattern: string) => void
}

export function PermissionDialog(props: PermissionDialogProps) {
  const language = useLanguage()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const buttonBaseStyle: JSX.CSSProperties = {
    "font-size": "14px",
    "line-height": "22px",
    height: "32px",
    padding: "0 16px",
    "min-width": "88px",
    "border-radius": "999px",
    cursor: "pointer",
    border: "none",
    "font-family": "var(--font-family-sans)",
  }

  const primaryButtonStyle: JSX.CSSProperties = {
    ...buttonBaseStyle,
    "background-color": "#0a59f7",
    color: "#fff",
  }

  const secondaryButtonStyle: JSX.CSSProperties = {
    ...buttonBaseStyle,
    "background-color": "#f3f3f3",
    color: "#191919",
  }

  return (
    <div
      data-component="permission-dialog"
      style={{
        "background-color": "#fff",
        "border-radius": "16px",
        "box-shadow": "0 8px 24px 0 rgba(0,0,0,0.16)",
        padding: "20px 24px",
        "font-family": "var(--font-family-sans)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "margin-bottom": "16px",
        }}
      >
        <WarningIcon />
        <span
          style={{
            "font-size": "14px",
            "line-height": "22px",
            "font-weight": "bold",
            color: "rgba(0, 0, 0, 0.9)",
          }}
        >
          {language.t("notification.permission.title")}
        </span>
      </div>

      {/* Description */}
      <div
        style={{
          "font-size": "14px",
          "line-height": "22px",
          color: "rgba(0, 0, 0, 0.9)",
        }}
      >
        <Show when={props.hint || toolDescription()}>
          <span>{props.hint || toolDescription()}</span>
        </Show>
      </div>

      {/* Patterns / File paths */}
      <Show when={props.request.patterns.length > 0}>
        <div
          style={{
            "font-size": "14px",
            "line-height": "22px",
            color: "#0a59f7",
            "word-break": "break-all",
            "margin-bottom": "16px",
            "text-align": "left",
          }}
        >
          <For each={props.request.patterns}>
            {(pattern) => (
              <button
                type="button"
                style={{
                  "font-size": "14px",
                  "line-height": "22px",
                  color: "#0a59f7",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: props.onOpenPath ? "pointer" : "default",
                  "text-decoration": props.onOpenPath ? "underline" : "none",
                  "font-family": "var(--font-family-sans)",
                  "text-align": "left",
                }}
                onClick={() => props.onOpenPath?.(pattern)}
              >
                {pattern}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Footer - Buttons */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "flex-end",
          gap: "8px",
          padding: "8px 0 4px",
        }}
      >
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => props.onDecide("reject")}
          disabled={props.responding}
          onMouseEnter={(e) => {
            e.currentTarget.style.setProperty("background-color", "#dfdfdf")
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.setProperty("background-color", "#f3f3f3")
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.setProperty("background-color", "#dfdfdf")
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.setProperty("background-color", "#dfdfdf")
          }}
        >
          {language.t("ui.permission.deny")}
        </button>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => props.onDecide("always")}
          disabled={props.responding}
          onMouseEnter={(e) => {
            e.currentTarget.style.setProperty("background-color", "#dfdfdf")
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.setProperty("background-color", "#f3f3f3")
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.setProperty("background-color", "#dfdfdf")
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.setProperty("background-color", "#dfdfdf")
          }}
        >
          {language.t("ui.permission.allowAlways")}
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => props.onDecide("once")}
          disabled={props.responding}
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
            e.currentTarget.style.setProperty("background-color", "#0a55eb")
          }}
        >
          {language.t("ui.permission.allowOnce")}
        </button>
      </div>
    </div>
  )
}
