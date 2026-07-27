import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import type { IntentConfirmDimension, IntentConfirmResult } from "../../agents/proto-intent-confirm"
import { readPagePatternMd } from "../../utils/pattern-resource"
import { type BlockModuleItem, getBlockContent } from "../../utils/pattern-resource"
import "../../assets/style/chat/intent-confirm-card.css"

export type IntentConfirmAnswers = Record<string, { selections: string[]; supplement: string }>

export function IntentConfirmCard(props: {
  sessionId: string
  result: IntentConfirmResult
  blockMatches: BlockModuleItem[]
  blockMatching: boolean
  blockMatchError?: boolean
  initialStep?: "patterns" | "blocks"
  onMatchPattern: (selectedItem: IntentConfirmDimension | null) => void
  onConfirm: (answers: IntentConfirmAnswers, enrichedInput: string, selectedBlocks: BlockModuleItem[]) => void
}): JSX.Element {
  // 匹配到的 page pattern 列表
  const hasResults = createMemo(() => props.result.results.length > 0)
  // 当前卡片步骤：patterns = page pattern 选择，blocks = block 模板选择
  const [step, setStep] = createSignal<"patterns" | "blocks">(props.initialStep ?? "patterns")
  // 切换 session 时 initialStep 会变，同步更新 step（用户手动点上一步/下一步不受影响，因为只依赖 initialStep）
  createEffect(() => {
    setStep(props.initialStep ?? "patterns")
  })
  // 用户选中的 page pattern id（单选）
  const [selectedPatternId, setSelectedPatternId] = createSignal<string | null>(null)
  // 用户选中的 block 模板：category → name（每个分类互斥，只能选一个）
  const [selectedBlocks, setSelectedBlocks] = createSignal<Record<string, string>>({})
  // 预览模态框的图片 URL（点击放大缩略图时设置，null 表示关闭）
  const [previewModalUrl, setPreviewModalUrl] = createSignal<string | null>(null)

  // page pattern 步骤点「下一步」/「跳过」：拉取选中 item 的 md 文档，放到 content 上再传给回调
  async function handleBlockPatterns() {
    const found = props.result.results.find(r => r.id === selectedPatternId()) ?? null
    let selected = found
    if (found?.file) {
      const mdResult = await readPagePatternMd(found.file)
      if (mdResult.success && mdResult.content) {
        selected = { ...found, content: mdResult.content }
      } else {
        showToast({ title: "请求Pattern资源失败，请联系开发人员！" })
        return
      }
    }
    props.onMatchPattern(selected)
    setStep("blocks")
  }

  function toggleBlock(category: string, id: string) {
    setSelectedBlocks(prev => {
      const next = { ...prev }
      if (next[category] === id) {
        delete next[category]
      } else {
        next[category] = id
      }
      return next
    })
  }

  async function handleConfirm() {
    const selectedIds = Object.values(selectedBlocks())
    const blocks = props.blockMatches.filter(m => selectedIds.includes(m.id))
    const blockPatterns = await getBlockContent({ results: blocks }, props.sessionId)
    props.onConfirm({}, "", blockPatterns.results)
  }

  return (
    <div class="ic-card">
      <div class="ic-card-head">
        <span class="ic-card-icon">?</span>
        <div class="ic-card-titles">
          <div class="ic-card-title">{step() === "patterns" ? "典型页面匹配" : "模块模板匹配"}</div>
          <div class="ic-card-desc">
            {step() === "patterns" ? "请选择最合适的典型页面模板" : "请选择需要使用的模块模板"}
          </div>
        </div>
      </div>

      {/* 步骤 1：page pattern 选择 */}
      <Show when={step() === "patterns"}>
        <div class="ic-card-body">
          <Show when={hasResults()} fallback={
            <div class="ic-card-empty">未匹配到合适的页面模板</div>
          }>
            <div class="ic-card-block-grid">
              <For each={props.result.results}>
                {(item) => {
                  const checked = () => selectedPatternId() === item.id
                  return (
                    <div
                      class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                      onClick={() => setSelectedPatternId(prev => prev === item.id ? null : item.id)}
                    >
                      <Show when={item.preview}>
                        <div class="ic-card-block-preview-wrap">
                          <img
                            class="ic-card-block-preview"
                            src={item.preview}
                            alt={item.name}
                          />
                          <button
                            class="ic-card-block-zoom"
                            onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(item.preview!) }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                          </button>
                        </div>
                      </Show>
                      <span class="ic-card-block-name">{item.name}</span>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        <div class="ic-card-foot">
          <Show when={hasResults()}>
            <button class="ic-card-submit-btn" onClick={handleBlockPatterns}>
              下一步
            </button>
          </Show>
          <Show when={!hasResults()}>
            <button class="ic-card-submit-btn" onClick={handleBlockPatterns}>
              跳过
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
                  const cat = m.category ?? "其他"
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
                          const checked = () => selectedBlocks()[cat] === match.id
                          return (
                            <div
                              class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                              onClick={() => toggleBlock(cat, match.id)}
                            >
                              <Show when={match.preview}>
                                <div class="ic-card-block-preview-wrap">
                                  <img
                                    class="ic-card-block-preview"
                                    src={match.preview!}
                                    alt={match.name}
                                  />
                                  <button
                                    class="ic-card-block-zoom"
                                    onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(match.preview!) }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                                  </button>
                                </div>
                              </Show>
                              <span class="ic-card-block-name">{match.name}</span>
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
          <button class="ic-card-next-btn" onClick={() => setStep("patterns")} disabled={props.blockMatching}>
            上一步
          </button>
          <button class="ic-card-next-btn" onClick={() => props.onMatchPattern(null)} disabled={props.blockMatching}>
            重试
          </button>
          <Show when={!props.blockMatching}>
            <button class="ic-card-submit-btn" onClick={handleConfirm}>
              {props.blockMatchError || props.blockMatches.length === 0 ? "跳过" : "下一步"}
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
