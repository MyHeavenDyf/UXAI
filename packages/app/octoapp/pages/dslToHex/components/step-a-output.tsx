import { createSignal, createEffect, createMemo, Show, type JSX } from "solid-js"
import { StepIndicator, type StepStatus } from "./step-indicator"

export type StepPhase = "a-generating" | "a-done" | "b-generating" | "b-done" | "c-generating" | "c-done"

export function StepAOutput(props: {
  description: string
  isGenerating: boolean
  phase: StepPhase
  onConfirm: (editedText: string) => void
}): JSX.Element {
  const [editText, setEditText] = createSignal("")
  const [dirty, setDirty] = createSignal(false)

  createEffect(() => {
    if (props.description && !dirty()) {
      setEditText(props.description)
    }
  })

  const steps = createMemo(() => {
    const aStatus: StepStatus = props.phase === "a-generating" ? "active" : "done"
    const bStatus: StepStatus =
      props.phase === "b-generating" ? "active" :
      props.phase === "b-done" || props.phase.startsWith("c-") ? "done" : "pending"
    const cStatus: StepStatus =
      props.phase === "c-generating" ? "active" :
      props.phase === "c-done" ? "done" : "pending"
    return [
      { label: "语义描述", status: aStatus },
      { label: "DSL生成", status: bStatus },
      { label: "预览渲染", status: cStatus },
    ]
  })

  const showConfirm = createMemo(() =>
    props.phase === "a-done" && props.description
  )

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: "#fff" }}>
      <StepIndicator steps={steps()} />

      <Show when={props.phase === "a-generating"}>
        <div class="flex-1 flex flex-col items-center justify-center" style={{ background: "#FAFAFA" }}>
          <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: "octo-spin 1s linear infinite" }}>
            <circle cx="20" cy="20" r="16" fill="none" stroke="#3478F6" stroke-width="3" stroke-dasharray="80 30" stroke-linecap="round" />
          </svg>
          <span style={{ "font-size": "15px", "font-weight": 500, color: "#333", "margin-top": "16px" }}>正在生成语义描述</span>
          <span style={{ "font-size": "13px", color: "#999", "margin-top": "4px" }}>AI 正在分析需求并构思布局方案</span>
        </div>
      </Show>

      <Show when={props.phase === "a-done"}>
        <div class="flex flex-col flex-1 min-h-0" style={{ padding: "20px 24px" }}>
          <div
            class="flex items-center justify-between shrink-0"
            style={{ height: "40px", "border-bottom": "1px solid rgba(0,0,0,0.06)", "margin-bottom": "12px" }}
          >
            <span style={{ "font-size": "14px", "font-weight": 600, color: "#191919" }}>
              语义布局描述
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setEditText(props.description); setDirty(false) }}
                style={{
                  padding: "4px 12px",
                  "border-radius": "4px",
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#fff",
                  color: "#666",
                  "font-size": "12px",
                  visibility: dirty() ? "visible" : "hidden",
                }}
              >
                还原
              </button>
              <button
                type="button"
                onClick={() => { setDirty(false); props.onConfirm(editText()) }}
                style={{
                  padding: "4px 12px",
                  "border-radius": "4px",
                  border: "none",
                  background: "#3478F6",
                  color: "#fff",
                  "font-size": "12px",
                  "font-weight": 500,
                  visibility: showConfirm() ? "visible" : "hidden",
                }}
              >
                确认生成
              </button>
            </div>
          </div>
          <textarea
            value={editText()}
            onInput={(e) => { setEditText(e.currentTarget.value); setDirty(true) }}
            class="w-full resize-none outline-none flex-1 min-h-0"
            style={{
              "font-size": "14px",
              "line-height": "24px",
              "font-family": "inherit",
              color: "#333",
              background: dirty() ? "#F5F5F5" : "#FAFAFA",
              border: dirty() ? "1px solid #3478F6" : "1px solid rgba(0,0,0,0.06)",
              "border-radius": "8px",
              padding: "12px 16px",
            }}
          />
        </div>
      </Show>
    </div>
  )
}
