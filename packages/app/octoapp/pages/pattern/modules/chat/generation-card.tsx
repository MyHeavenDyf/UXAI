import { Show, type JSX } from "solid-js"
import "../../assets/style/chat/generation-card.css"

export function GenerationCard(props: {
  generating: boolean
  canPreview: boolean
  cancelled: boolean
  error?: string
  errorAgent?: string
  errorCallId?: string
  needsConfirm: boolean
  confirmText?: { title: string; subtitle: string } | null
  onRetry?: () => void
}): JSX.Element {
  const cardState = () => {
    if (props.error) {
      const parts = [props.errorAgent, "生成异常，请重试"].filter(Boolean)
      return { title: props.error, subtitle: parts.join(" · "), badge: "gc-error-badge", badgeText: "失败" } as const
    }
    if (props.needsConfirm && props.confirmText) return { title: props.confirmText.title, subtitle: props.confirmText.subtitle, badge: "gc-confirm-badge", badgeText: "待确认" } as const
    if (props.generating) return { title: "正在执行中", subtitle: "请稍候…", badge: "gc-gen-badge", badgeText: "生成中" } as const
    if (props.cancelled) return { title: "已取消", subtitle: "生成已中断", badge: "gc-cancel-badge", badgeText: "取消" } as const
    return { title: "生成完成", subtitle: "请在右侧查看", badge: "gc-done-badge", badgeText: "完成" } as const
  }

  return (
    <Show when={props.generating || props.canPreview || props.cancelled || props.error || props.needsConfirm}>
      <div
        class="generation-card mx-3 mb-3 text-left transition-all"
        classList={{ generating: props.generating && !props.error, cancelled: props.cancelled, error: !!props.error, confirming: !!props.needsConfirm }}
      >
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 flex items-center">
            <img src="/AI_doc_plaintext.svg" width={28} height={28} alt="" />
          </span>
          <div class="flex flex-col min-w-0 flex-1">
            <span class="gc-title truncate">{cardState().title}</span>
            <Show when={cardState().subtitle}>
              <span class="gc-subtitle">{cardState().subtitle}</span>
            </Show>
          </div>
          <Show when={props.generating && !props.error} fallback={
            <Show when={props.error && props.onRetry} fallback={
              <span class={cardState().badge}>{cardState().badgeText}</span>
            }>
              <button class="gc-retry-btn" onClick={() => props.onRetry!()}>重试</button>
            </Show>
          }>
            <span class="gc-gen-badge">
              <span class="w-1.5 h-1.5 rounded-full animate-pulse gc-pulse-dot" />
              生成中
            </span>
          </Show>
        </div>
      </div>
    </Show>
  )
}
