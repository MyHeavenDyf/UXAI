import { For, type JSX } from "solid-js"

export type StepStatus = "pending" | "active" | "done"

function StepNode(props: { index: number; label: string; status: StepStatus }): JSX.Element {
  return (
    <div
      class="flex items-center gap-1.5"
      style={{
        "font-size": "13px",
        "font-weight": props.status === "active" ? 600 : 400,
        color: props.status === "done" ? "#10B981" : props.status === "active" ? "#191919" : "#999",
      }}
    >
      {props.status === "done" && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "#10B981" }}>
          <circle cx="7" cy="7" r="6" fill="#10B981" />
          <path d="M4.5 7l2 2 3-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      )}
      {props.status === "active" && (
        <span
          class="inline-flex items-center justify-center"
          style={{
            width: "14px",
            height: "14px",
            "border-radius": "50%",
            background: "#3478F6",
            color: "#fff",
            "font-size": "10px",
            "font-weight": 700,
          }}
        >
          {props.index}
        </span>
      )}
      {props.status === "pending" && (
        <span
          class="inline-flex items-center justify-center"
          style={{
            width: "14px",
            height: "14px",
            "border-radius": "50%",
            border: "1.5px solid #ccc",
            color: "#999",
            "font-size": "10px",
            "font-weight": 700,
          }}
        >
          {props.index}
        </span>
      )}
      <span>{props.label}</span>
    </div>
  )
}

export function StepIndicator(props: {
  steps: Array<{ label: string; status: StepStatus }>
}): JSX.Element {
  return (
    <div
      class="flex items-center shrink-0"
      style={{
        padding: "12px 20px",
        "border-bottom": "1px solid rgba(0,0,0,0.06)",
        background: "#fff",
      }}
    >
      <For each={props.steps}>
        {(step, i) => (
          <div class="flex items-center">
            {i() > 0 && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{ margin: "0 8px", color: step.status === "done" ? "#10B981" : "#999" }}
              >
                <path d="M6 3l4 5-4 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            )}
            <StepNode index={i() + 1} label={step.label} status={step.status} />
          </div>
        )}
      </For>
    </div>
  )
}
