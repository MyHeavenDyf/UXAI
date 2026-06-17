import { For, Show } from "solid-js"
import type { JSX } from "solid-js"

export type StepStatus = "wait" | "process" | "finish" | "error"

export interface StepItem {
  title: string
  description?: string
  status?: StepStatus
}

export interface StepsProps {
  current: number
  items: StepItem[]
  direction?: "horizontal" | "vertical"
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function resolveStatus(index: number, current: number, override?: StepStatus): StepStatus {
  if (override) return override
  if (index < current) return "finish"
  if (index === current) return "process"
  return "wait"
}

export function Steps(props: StepsProps): JSX.Element {
  const direction = () => props.direction ?? "horizontal"

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": direction() === "vertical" ? "column" : "row",
        "align-items": direction() === "horizontal" ? "center" : "flex-start",
        width: "100%",
      }}
    >
      <For each={props.items}>
        {(item, i) => {
          const status = () => resolveStatus(i(), props.current, item.status)
          const isLast = () => i() === props.items.length - 1
          const isFinish = () => status() === "finish"
          const isProcess = () => status() === "process"
          const isError = () => status() === "error"

          const dotBg = () => isFinish() ? "#0A59F7" : "#fff"
          const dotBorder = () => isFinish() || isProcess() ? "#0A59F7" : isError() ? "#f5222d" : "rgba(0,0,0,0.15)"
          const dotColor = () => isFinish() ? "#fff" : isProcess() ? "#0A59F7" : isError() ? "#f5222d" : "rgba(0,0,0,0.25)"
          const titleColor = () => isProcess() ? "rgba(0,0,0,0.9)" : isFinish() ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.35)"
          const lineColor = () => isFinish() ? "#0A59F7" : "rgba(0,0,0,0.1)"

          return (
            <div
              style={{
                display: "flex",
                "flex-direction": direction() === "vertical" ? "column" : "row",
                "align-items": direction() === "horizontal" ? "center" : "flex-start",
                flex: isLast() ? "0 0 auto" : "1",
                "min-width": "0",
              }}
            >
              {/* Dot + label (horizontal: side by side) */}
              <div style={{ display: "flex", "align-items": "center", "flex-shrink": "0", gap: "8px" }}>
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    "border-radius": "50%",
                    border: `2px solid ${dotBorder()}`,
                    background: dotBg(),
                    color: dotColor(),
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    "flex-shrink": "0",
                    "font-size": "11px",
                    "font-weight": "600",
                    transition: "all 200ms ease",
                    "box-shadow": isProcess() ? "0 0 0 3px rgba(10,89,247,0.12)" : "none",
                  }}
                >
                  <Show when={isFinish()} fallback={
                    <Show when={isError()} fallback={<span>{i() + 1}</span>}>
                      <CloseIcon />
                    </Show>
                  }>
                    <CheckIcon />
                  </Show>
                </div>

                {/* Label */}
                <Show when={direction() === "horizontal"}>
                  <div style={{ "white-space": "nowrap" }}>
                    <div
                      style={{
                        "font-size": "13px",
                        "font-weight": isProcess() ? "600" : "400",
                        "line-height": "20px",
                        color: titleColor(),
                        transition: "color 200ms ease",
                      }}
                    >
                      {item.title}
                    </div>
                    <Show when={item.description}>
                      <div style={{ "font-size": "12px", "line-height": "18px", color: "rgba(0,0,0,0.35)", "margin-top": "2px" }}>
                        {item.description}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Connector line */}
              <Show when={!isLast()}>
                <div
                  style={{
                    background: lineColor(),
                    transition: "background 300ms ease",
                    ...(direction() === "vertical"
                      ? { width: "2px", height: "16px", "margin-left": "9px" }
                      : { height: "2px", flex: "1", "min-width": "24px", margin: "0 12px" }
                    ),
                  }}
                />
              </Show>

              {/* Vertical label (only for vertical direction) */}
              <Show when={direction() === "vertical"}>
                <div style={{ "padding-top": "4px", "padding-bottom": isLast() ? "0" : "16px", "padding-left": "28px", "margin-top": "-20px" }}>
                  <div
                    style={{
                      "font-size": "13px",
                      "font-weight": isProcess() ? "600" : "400",
                      "line-height": "20px",
                      color: titleColor(),
                      transition: "color 200ms ease",
                    }}
                  >
                    {item.title}
                  </div>
                  <Show when={item.description}>
                    <div style={{ "font-size": "12px", "line-height": "18px", color: "rgba(0,0,0,0.35)", "margin-top": "2px" }}>
                      {item.description}
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}
