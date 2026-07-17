import { createSignal, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { IntentConfirmDimension, IntentConfirmResult } from "../../agents/proto-intent-confirm"
import "../../assets/style/chat/intent-confirm-card.css"

export type IntentConfirmAnswers = Record<string, { selections: string[]; supplement: string }>

export function IntentConfirmCard(props: {
  result: IntentConfirmResult
  onConfirm: (answers: IntentConfirmAnswers, enrichedInput: string) => void
}): JSX.Element {
  const dimensionEntries = Object.entries(props.result.options)

  const [activeTab, setActiveTab] = createSignal(0)
  const [answers, setAnswers] = createStore<IntentConfirmAnswers>(
    Object.fromEntries(dimensionEntries.map(([name]) => [name, { selections: [], supplement: "" }])),
  )

  function toggleSelection(dimName: string, type: string, option: string) {
    const current = answers[dimName]?.selections ?? []
    if (type === "single") {
      setAnswers(dimName, "selections", current.includes(option) ? [] : [option])
    } else {
      setAnswers(dimName, "selections",
        current.includes(option) ? current.filter((v: string) => v !== option) : [...current, option],
      )
    }
  }

  function handleConfirm() {
    const parts: string[] = []
    for (const [dimName, ans] of Object.entries(answers) as [string, { selections: string[]; supplement: string }][]) {
      if (ans.selections.length > 0) parts.push(`${dimName}: ${ans.selections.join("、")}`)
      if (ans.supplement.trim()) parts.push(`${dimName}补充: ${ans.supplement.trim()}`)
    }
    const enrichedInput = parts.length > 0 ? `\n\n请额外遵循以下要求：\n${parts.join("\n")}` : ""
    props.onConfirm(answers, enrichedInput)
  }

  const activeDim = () => dimensionEntries[activeTab()]
  const isLastTab = () => activeTab() === dimensionEntries.length - 1

  return (
    <div class="ic-card">
      <div class="ic-card-head">
        <span class="ic-card-icon">?</span>
        <div class="ic-card-titles">
          <div class="ic-card-title">需求确认</div>
          <div class="ic-card-desc">请补充以下维度，更精准生成页面</div>
        </div>
      </div>

      <Show when={dimensionEntries.length > 1}>
        <div class="ic-card-tabs">
          <For each={dimensionEntries}>
            {([dimName], i) => (
              <button
                class={`ic-card-tab ${activeTab() === i() ? "ic-card-tab-active" : ""}`}
                onClick={() => setActiveTab(i())}
              >
                {dimName}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="ic-card-body">
        <For each={[activeDim()]}>
          {([dimName, dim]: [string, IntentConfirmDimension]) => (
            <div class="ic-card-field">
              <div class="ic-card-field-header">
                <span class="ic-card-label">{dimName}</span>
                <span class="ic-card-type-tag">{dim.type === "single" ? "单选" : "多选"}</span>
              </div>
              <div class="ic-card-options">
                <For each={dim.options}>
                  {(option) => {
                    const checked = () => answers[dimName]?.selections.includes(option) ?? false
                    return (
                      <label class={`ic-card-check ${checked() ? "ic-card-check-on" : ""}`}>
                        <input
                          type={dim.type === "single" ? "radio" : "checkbox"}
                          name={dimName}
                          checked={checked()}
                          onChange={() => toggleSelection(dimName, dim.type, option)}
                        />
                        <span>{option}</span>
                      </label>
                    )
                  }}
                </For>
              </div>
              <input
                type="text"
                class="ic-card-supplement"
                placeholder="补充说明（可选）"
                value={answers[dimName]?.supplement ?? ""}
                onInput={(e) => setAnswers(dimName, "supplement", e.currentTarget.value)}
              />
            </div>
          )}
        </For>
      </div>

      <div class="ic-card-foot">
        <Show when={!isLastTab()} fallback={
          <button class="ic-card-submit-btn" onClick={handleConfirm}>
            确认并继续生成
          </button>
        }>
          <button class="ic-card-next-btn" onClick={() => setActiveTab(activeTab() + 1)}>
            下一步
          </button>
        </Show>
      </div>
    </div>
  )
}
