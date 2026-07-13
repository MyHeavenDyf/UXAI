import { Show, type JSX } from "solid-js"
import "../../assets/style/chat/generation-card.css"

export function GenerationCard(props: {
  generating: boolean
  aborted?: boolean
  failed?: boolean
  canPreview: boolean
  onOpenPreview: () => void
}): JSX.Element {
  const title = () => props.generating ? "场景生成中" : props.aborted ? "已中止" : props.failed ? "生成失败" : "生成完成"
  const subtitle = () => props.generating ? "请稍候…" : props.aborted ? "生成被中断" : props.failed ? "生成出错,请重试" : "点击查看预览"

  return (
    <Show when={props.generating || props.canPreview || props.aborted || props.failed}>
      <button
        type="button"
        disabled={props.generating}
        onClick={() => !props.generating && !props.aborted && !props.failed && props.canPreview && props.onOpenPreview()}
        class="generation-card mx-3 mb-3 text-left transition-all"
        classList={{ generating: props.generating, aborted: !!props.aborted, failed: !!props.failed }}
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
          <Show when={!props.generating && props.aborted}>
            <span class="gc-abort-badge">中止</span>
          </Show>
          <Show when={!props.generating && props.failed}>
            <span class="gc-fail-badge">失败</span>
          </Show>
          <Show when={!props.generating && !props.aborted && !props.failed && props.canPreview}>
            <span class="gc-done-badge">完成</span>
          </Show>
        </div>
      </button>
    </Show>
  )
}
