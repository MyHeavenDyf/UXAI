import { createSignal, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { IntentConfirmDimension, IntentConfirmResult } from "../../agents/scene-intent-confirm"
import type { PatternMatchItem } from "../../utils/scene-resource"
import "../../assets/style/chat/intent-confirm-card.css"

export type IntentConfirmAnswers = Record<string, { selections: string[]; supplement: string }>

export function IntentConfirmCard(props: {
  result: IntentConfirmResult
  blockMatches: PatternMatchItem[]
  blockMatching: boolean
  blockMatchError?: boolean
  initialStep?: "dimensions" | "blocks"
  onMatchPattern: (enrichedInput: string) => void
  onConfirm: (answers: IntentConfirmAnswers, enrichedInput: string, selectedBlocks: PatternMatchItem[]) => void
}): JSX.Element {
  // 维度列表（从 intent_confirm 结果中提取）
  const dimensionEntries = Object.entries(props.result.options)
  // 是否有维度需要确认（无维度时跳过第一步直接进 block 选择）
  const hasDimensions = dimensionEntries.length > 0
  // 当前卡片步骤：dimensions = 维度确认，blocks = 模板选择
  const [step, setStep] = createSignal<"dimensions" | "blocks">(props.initialStep ?? (hasDimensions ? "dimensions" : "blocks"))
  // 维度确认步骤中当前激活的 tab 索引
  const [activeTab, setActiveTab] = createSignal(0)
  // 用户在每个维度下的选择（选中项 + 补充说明）
  const [answers, setAnswers] = createStore<IntentConfirmAnswers>(
    Object.fromEntries(dimensionEntries.map(([name]) => [name, { selections: [], supplement: "" }])),
  )
  // 用户选中的 block 模板：category → name（每个分类互斥，只能选一个）
  const [selectedBlocks, setSelectedBlocks] = createSignal<Record<string, string>>({})
  // 预览模态框的图片 URL（点击放大缩略图时设置，null 表示关闭）
  const [previewModalUrl, setPreviewModalUrl] = createSignal<string | null>(null)

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

  function buildEnrichedInput(): string {
    const parts: string[] = []
    for (const [dimName, ans] of Object.entries(answers) as [string, { selections: string[]; supplement: string }][]) {
      if (ans.selections.length > 0) parts.push(`${dimName}: ${ans.selections.join("、")}`)
      if (ans.supplement.trim()) parts.push(`${dimName}补充: ${ans.supplement.trim()}`)
    }
    return parts.length > 0 ? `\n\n请额外遵循以下要求：\n${parts.join("\n")}` : ""
  }

  function handleMatchPattern() {
    const enrichedInput = buildEnrichedInput()
    props.onMatchPattern(enrichedInput)
    setStep("blocks")
  }

  function toggleBlock(category: string, name: string) {
    setSelectedBlocks(prev => {
      const next = { ...prev }
      if (next[category] === name) {
        delete next[category]
      } else {
        next[category] = name
      }
      return next
    })
  }

  function handleConfirm() {
    const enrichedInput = buildEnrichedInput()
    const selectedNames = Object.values(selectedBlocks())
    const blocks = props.blockMatches.filter(m => selectedNames.includes(m.pattern.name))
    props.onConfirm(answers, enrichedInput, blocks)
  }

  const activeDim = () => dimensionEntries[activeTab()]
  const isLastDimTab = () => activeTab() === dimensionEntries.length - 1

  return (
    <div class="ic-card">
      <div class="ic-card-head">
        <span class="ic-card-icon">?</span>
        <div class="ic-card-titles">
          <div class="ic-card-title">{step() === "dimensions" ? "需求确认" : "模板匹配"}</div>
          <div class="ic-card-desc">
            {step() === "dimensions"
              ? "请补充以下维度，更精准生成页面"
              : "请选择需要使用的模板"}
          </div>
        </div>
      </div>

      {/* 步骤 1：维度确认 */}
      <Show when={step() === "dimensions"}>
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
                  <Show when={dimensionEntries.length <= 1}>
                    <span class="ic-card-label">{dimName}</span>
                  </Show>
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
          <Show when={!isLastDimTab()} fallback={
            <button class="ic-card-submit-btn" onClick={handleMatchPattern}>
              下一步
            </button>
          }>
            <button class="ic-card-next-btn" onClick={() => setActiveTab(activeTab() + 1)}>
              下一步
            </button>
          </Show>
        </div>
      </Show>

      {/* 步骤 2：block 模板选择 */}
      <Show when={step() === "blocks"}>
        <div class="ic-card-body">
          <Show when={!props.blockMatching} fallback={
            <div class="ic-card-loading">
              <span class="ic-card-spinner" />
              <span>正在匹配模块模板...</span>
            </div>
          }>
            <Show when={!props.blockMatchError} fallback={
              <div class="ic-card-error">匹配出错，请重试</div>
            }>
              <Show when={props.blockMatches.length > 0} fallback={
                <div class="ic-card-empty">未匹配到合适的模块模板</div>
              }>
              <For each={Object.entries(
                props.blockMatches.reduce((acc, m) => {
                  const cat = m.pattern.category ?? "其他"
                  if (!acc[cat]) acc[cat] = []
                  acc[cat].push(m)
                  return acc
                }, {} as Record<string, typeof props.blockMatches>)
              )}>
                {([category, matches]) => (
                  <div class="ic-card-block-group">
                    <div class="ic-card-block-category">{category}</div>
                    <div class="ic-card-block-grid">
                      <For each={matches}>
                        {(match) => {
                          const cat = category
                          const checked = () => selectedBlocks()[cat] === match.pattern.name
                          return (
                            <div
                              class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                              onClick={() => toggleBlock(cat, match.pattern.name)}
                            >
                              <Show when={match.previewUrl}>
                                <div class="ic-card-block-preview-wrap">
                                  <img
                                    class="ic-card-block-preview"
                                    src={match.previewUrl!}
                                    alt={match.pattern.name}
                                  />
                                  <button
                                    class="ic-card-block-zoom"
                                    onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(match.previewUrl!) }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                                  </button>
                                </div>
                              </Show>
                              <span class="ic-card-block-name">{match.pattern.name}</span>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
            </Show>
          </Show>
        </div>

        <div class="ic-card-foot">
          <button class="ic-card-next-btn" onClick={() => setStep("dimensions")} disabled={props.blockMatching}>
            上一步
          </button>
          <button class="ic-card-next-btn" onClick={() => handleMatchPattern()} disabled={props.blockMatching}>
            重试
          </button>
          <Show when={!props.blockMatching}>
            <button class="ic-card-submit-btn" onClick={handleConfirm}>
              下一步
            </button>
          </Show>
        </div>
      </Show>

      <Show when={previewModalUrl()}>
        <div class="ic-card-preview-modal" onClick={() => setPreviewModalUrl(null)}>
          <img class="ic-card-preview-modal-img" src={previewModalUrl()!} alt="preview" />
        </div>
      </Show>
    </div>
  )
}
