import { Show, type JSX } from "solid-js"
import "../../assets/style/chat/generation-card.css"

export function GenerationCard(props: {
  generating: boolean
  canPreview: boolean
  onOpenPreview: () => void
}): JSX.Element {
  return (
    <Show when={props.generating || props.canPreview}>
      <button
        type="button"
        disabled={props.generating}
        onClick={() => !props.generating && props.onOpenPreview()}
        class="generation-card mx-3 mb-3 text-left transition-all"
        classList={{ generating: props.generating }}
      >
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 flex items-center">
            <img src="/AI_doc_plaintext.svg" width={28} height={28} alt="" />
          </span>
          <div class="flex flex-col min-w-0 flex-1">
            <span class="gc-title truncate">{props.generating ? "页面生成中" : "生成完成"}</span>
            <span class="gc-subtitle">{props.generating ? "请稍候…" : "点击查看预览"}</span>
          </div>
          <Show when={props.generating} fallback={
            <Show when={props.canPreview}>
              <span class="gc-done-badge">完成</span>
            </Show>
          }>
            <span class="gc-gen-badge">
              <span class="w-1.5 h-1.5 rounded-full animate-pulse gc-pulse-dot" />
              生成中
            </span>
          </Show>
        </div>
      </button>
    </Show>
  )
}
