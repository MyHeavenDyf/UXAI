import { createSignal, For } from "solid-js"
import type { JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import type { StrategyFormData } from "../../utils/strategy-form-scanner"
import { IconCardPlan } from "../../icons"

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
  isGenerating?: boolean
}): JSX.Element {
  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      {/* Header */}
      <div
        class="flex items-center justify-between shrink-0"
        style={{
          padding: "16px 24px",
          "border-bottom": "1px solid rgba(0,0,0,0.06)",
          background: "#fff",
        }}
      >
        <div class="flex items-center gap-2">
          <IconCardPlan size={18} class="shrink-0" />
          <span class="text-[15px] font-semibold" style={{ color: "var(--octo-text-primary)" }}>
            设计策略准备
          </span>
        </div>
        <Button
          variant="primary"
          size="small"
          onClick={props.onGenerate}
          disabled={props.isGenerating}
        >
          {props.isGenerating ? "生成中…" : "策略生成"}
        </Button>
      </div>

      {/* Form body */}
      <div class="flex-1 overflow-y-auto" style={{ padding: "24px" }}>
        <For each={SECTIONS}>
          {(section) => (
            <div class="mb-6">
              <h3
                class="text-[14px] font-semibold mb-3"
                style={{ color: "var(--octo-text-primary)" }}
              >
                {section.title}
              </h3>
              <div class="flex flex-col gap-3">
                <For each={section.fields}>
                  {(field) => (
                    <div class="flex flex-col gap-1">
                      <label
                        class="text-[12px] font-medium"
                        style={{ color: "var(--octo-text-secondary)" }}
                      >
                        {field.label}
                      </label>
                      <textarea
                        value={props.formData[field.key] ?? ""}
                        onInput={(e) => props.onFieldChange(field.key, e.currentTarget.value)}
                        rows={3}
                        class="resize-y outline-none p-2.5 rounded-[6px] text-[13px]"
                        style={{
                          "font-family": "var(--octo-font)",
                          background: "rgba(0,0,0,0.02)",
                          border: "1px solid rgba(0,0,0,0.08)",
                          color: "var(--octo-text-primary)",
                          "min-height": "64px",
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
    </div>
  )
}
