import { For, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import type { IntentConfirmDimension, IntentConfirmResult } from "../../agents/proto_intent_confirm"
import "../../assets/style/preview/intent-confirm.css"

export type IntentConfirmAnswers = Record<string, { selections: string[]; supplement: string }>

export function IntentConfirmReview(props: {
  result: IntentConfirmResult
  onConfirm: (answers: IntentConfirmAnswers, enrichedInput: string) => void
}): JSX.Element {
  const dimensionEntries = Object.entries(props.result.options)

  const [answers, setAnswers] = createStore<IntentConfirmAnswers>(
    Object.fromEntries(dimensionEntries.map(([name]) => [name, { selections: [], supplement: "" }])),
  )

  function toggleSelection(dimName: string, type: string, option: string) {
    const current = answers[dimName]?.selections ?? []
    if (type === "single") {
      setAnswers(dimName, "selections", current.includes(option) ? [] : [option])
    } else {
      setAnswers(dimName, "selections",
        current.includes(option) ? current.filter(v => v !== option) : [...current, option],
      )
    }
  }

  function updateSupplement(dimName: string, value: string) {
    setAnswers(dimName, "supplement", value)
  }

  function handleConfirm() {
    const parts: string[] = []
    for (const [dimName, ans] of Object.entries(answers)) {
      if (ans.selections.length > 0) parts.push(`${dimName}: ${ans.selections.join("、")}`)
      if (ans.supplement.trim()) parts.push(`${dimName}补充: ${ans.supplement.trim()}`)
    }
    const enrichedInput = parts.length > 0 ? `\n\n用户补充确认：\n${parts.join("\n")}` : ""
    debugger
    props.onConfirm(answers, enrichedInput)
  }

  return (
    <div class="intent-confirm-container">
      <div class="intent-confirm-header">
        <div class="intent-confirm-header-left">
          <span class="intent-confirm-icon">?</span>
          <div class="intent-confirm-header-titles">
            <div class="intent-confirm-header-title">需求确认</div>
            <div class="intent-confirm-header-subtitle">
              请选择或补充以下维度，帮助更精准地生成页面
            </div>
          </div>
        </div>
        <div class="intent-confirm-header-right">
          <Button variant="primary" size="large" onClick={handleConfirm} style={{ "background-color": "var(--octo-brand)", color: "white" }}>
            确认并继续生成
          </Button>
        </div>
      </div>

      <div class="intent-confirm-body">
        <For each={dimensionEntries}>
          {([dimName, dim]: [string, IntentConfirmDimension]) => (
            <div class="ic-field">
              <div class="ic-field-header">
                <span class="ic-label">{dimName}</span>
                <span class="ic-type-tag">{dim.type === "single" ? "单选" : "多选"}</span>
              </div>
              <div class="ic-options">
                <For each={dim.options}>
                  {(option) => {
                    const selected = () => answers[dimName]?.selections.includes(option) ?? false
                    return (
                      <button
                        type="button"
                        class={`ic-chip ${selected() ? "ic-chip-on" : ""}`}
                        onClick={() => toggleSelection(dimName, dim.type, option)}
                      >
                        {option}
                      </button>
                    )
                  }}
                </For>
              </div>
              <input
                type="text"
                class="ic-supplement"
                placeholder="补充说明（可选）"
                value={answers[dimName]?.supplement ?? ""}
                onInput={(e) => updateSupplement(dimName, e.currentTarget.value)}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
