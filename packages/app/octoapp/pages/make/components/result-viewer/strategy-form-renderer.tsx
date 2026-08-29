import { For } from "solid-js"
import type { JSX } from "solid-js"
import type { StrategyFormData } from "../../utils/strategy-form-scanner"

interface FormSection {
  title: string
  fields: { key: keyof StrategyFormData; label: string }[]
}

const SECTIONS: FormSection[] = [
  {
    title: "设计需求",
    fields: [
      { key: "需求背景", label: "需求背景" },
      { key: "设计目标", label: "设计目标" },
      { key: "设计方法", label: "设计方法" },
      { key: "其他", label: "其他" },
    ],
  },
  {
    title: "洞察&研究",
    fields: [
      { key: "用户画像", label: "用户画像" },
      { key: "用户旅程", label: "用户旅程" },
      { key: "研究报告", label: "研究报告" },
    ],
  },
]

export function StrategyFormRenderer(props: {
  formData: StrategyFormData
  onFieldChange: (field: keyof StrategyFormData, value: string) => void
  onGenerate: () => void
  onCancel?: () => void
  isGenerating?: boolean
  disabled?: boolean
  currentStep?: number
}): JSX.Element {
  const currentStep = () => props.currentStep ?? 1
  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      {/* Header */}
      <div
        class="flex flex-col shrink-0"
        style={{
          padding: "24px",
          "border-bottom": "1px solid rgba(0,0,0,0.06)",
          background: "#fff",
        }}
      >
        {/* Step indicator */}
        <div class="flex items-center" style={{ "margin-bottom": "24px" }}>
          <div class="flex items-center gap-[8px]">
            <div
              style={{
                width: "24px",
                height: "24px",
                "border-radius": "999px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "14px",
                "line-height": "22px",
                background: currentStep() === 1 ? "#0a59f7" : "#fff",
                border: currentStep() === 1 ? "1px solid #0a59f7" : "1px solid rgba(0,0,0,0.2)",
                color: currentStep() === 1 ? "#fff" : "rgba(0,0,0,0.9)",
              }}
            >
              1
            </div>
            <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}>
              策略准备
            </span>
          </div>
          <div
            style={{
              width: "120px",
              height: "1px",
              "margin-left": "8px",
              "margin-right": "8px",
              background: "rgba(0,0,0,0.2)",
            }}
          />
          <div class="flex items-center gap-[8px]">
            <div
              style={{
                width: "24px",
                height: "24px",
                "border-radius": "999px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "14px",
                "line-height": "22px",
                background: currentStep() === 2 ? "#0a59f7" : "#fff",
                border: currentStep() === 2 ? "1px solid #0a59f7" : "1px solid rgba(0,0,0,0.2)",
                color: currentStep() === 2 ? "#fff" : "rgba(0,0,0,0.9)",
              }}
            >
              2
            </div>
            <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}>
              策略生成
            </span>
          </div>
        </div>
        {/* Title */}
        <span style={{ "font-size": "24px", "line-height": "32px", "font-weight": "bold", color: "rgba(0,0,0,0.9)" }}>
          设计策略准备
        </span>
      </div>

      {/* Form body */}
      <div class="flex-1 overflow-y-auto" style={{ padding: "24px", display: "flex", "flex-direction": "column", gap: "16px" }}>
        <For each={SECTIONS}>
          {(section) => (
            <div style={{ padding: "24px", "border-radius": "16px", background: "rgba(0,0,0,0.03)" }}>
              <h3 style={{ "font-size": "16px", "line-height": "24px", "font-weight": "bold", color: "rgba(0,0,0,0.9)", "margin-bottom": "20px" }}>
                {section.title}
              </h3>
              <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
                <For each={section.fields}>
                  {(field) => (
                    <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                      <label style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0,0,0,0.9)" }}>
                        {field.label}
                      </label>
                      <textarea
                        value={props.formData[field.key] ?? ""}
                        onInput={(e) => props.onFieldChange(field.key, e.currentTarget.value)}
                        rows={3}
                        class="resize-y outline-none"
                        disabled={props.disabled}
                        style={{
                          "font-size": "14px",
                          "line-height": "22px",
                          color: "rgba(0,0,0,0.9)",
                          "font-family": "var(--octo-font)",
                          background: props.disabled ? "rgba(0,0,0,0.03)" : "#fff",
                          border: "1px solid rgba(0,0,0,0.1)",
                          "border-radius": "8px",
                          padding: "8px 12px",
                          height: "80px",
                        }}
                        placeholder={`请输入${field.label}…`}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Bottom footer */}
      <div
        class="flex items-center justify-end shrink-0"
        style={{
          height: "56px",
          padding: "0 24px",
          gap: "8px",
          "border-top": "1px solid rgba(0,0,0,0.1)",
          background: "#fff",
        }}
      >
        <button
          type="button"
          class="text-[14px] rounded-[999px] transition-colors"
          style={{
            height: "32px",
            padding: "0 16px",
            "line-height": "22px",
            background: props.disabled ? "#e0e0e0" : "#f3f3f3",
            color: props.disabled ? "#aaa" : "#191919",
            border: "none",
            cursor: props.disabled ? "not-allowed" : "pointer",
            "pointer-events": props.disabled ? "none" : "auto",
          }}
          onClick={props.onCancel}
          disabled={props.disabled}
        >
          取消
        </button>
        <button
          type="button"
          class="text-[14px] font-medium rounded-[999px] text-white transition-colors"
          style={{
            height: "32px",
            padding: "0 16px",
            "line-height": "22px",
            background: (props.isGenerating || props.disabled) ? "#b0b0b0" : "#0a59f7",
            color: "white",
            border: "none",
            cursor: (props.isGenerating || props.disabled) ? "not-allowed" : "pointer",
            "pointer-events": (props.isGenerating || props.disabled) ? "none" : "auto",
          }}
          onClick={props.onGenerate}
          disabled={props.isGenerating || props.disabled}
        >
          {props.isGenerating ? "生成中…" : "策略生成"}
        </button>
      </div>
    </div>
  )
}
