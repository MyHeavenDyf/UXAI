import { Show, type JSX } from "solid-js"
import "../../assets/style/chat/generation-card.css"

export type GenOutcome = "completed" | "aborted" | "failed"

/** 单轮生成的卡片:生成中 / 已中止(禁用) / 生成失败(禁用) / 生成完成(可点击切回该轮场景) */
export function GenerationCard(props: {
  generating: boolean
  outcome: GenOutcome
  /** 该轮是否有对应场景版本(完成的卡片可点击切回) */
  canSwitch: boolean
  onSwitch: () => void
}): JSX.Element {
  const title = () =>
    props.generating ? "场景生成中"
      : props.outcome === "aborted" ? "已中止"
      : props.outcome === "failed" ? "生成失败"
      : "生成完成"
  const subtitle = () =>
    props.generating ? "请稍候…"
      : props.outcome === "aborted" ? "生成被中断"
      : props.outcome === "failed" ? "生成出错,请重试"
      : "点击切换到该场景"
  // 只有「生成完成 + 有版本」可点击;生成中 / 已中止 / 生成失败 一律禁用
  const clickable = () => !props.generating && props.outcome === "completed" && props.canSwitch

  return (
    <button
      type="button"
      disabled={!clickable()}
      onClick={() => clickable() && props.onSwitch()}
      class="generation-card mx-3 mb-3 text-left transition-all"
      classList={{
        generating: props.generating,
        aborted: !props.generating && props.outcome === "aborted",
        failed: !props.generating && props.outcome === "failed",
      }}
    >
      <div class="flex items-center gap-3">
        <span class="flex-shrink-0 flex items-center">
          <img src="/AI_doc_plaintext.svg" width={28} height={28} alt="" />
        </span>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="gc-title truncate">{title()}</span>
          <span class="gc-subtitle">{subtitle()}</span>
        </div>
        <Show when={props.generating}>
          <span class="gc-gen-badge">
            <span class="w-1.5 h-1.5 rounded-full animate-pulse gc-pulse-dot" />
            生成中
          </span>
        </Show>
        <Show when={!props.generating && props.outcome === "aborted"}>
          <span class="gc-abort-badge">中止</span>
        </Show>
        <Show when={!props.generating && props.outcome === "failed"}>
          <span class="gc-fail-badge">失败</span>
        </Show>
        <Show when={clickable()}>
          <span class="gc-done-badge">完成</span>
        </Show>
      </div>
    </button>
  )
}
