export function shouldShowContextWarning(usage: number, sessionID?: string, ignoredSessionID?: string, busy = false) {
  return !busy && !!sessionID && usage >= 80 && ignoredSessionID !== sessionID
}

export function isContextAtLimit(tokens: number, limit?: number, sessionID?: string) {
  return !!sessionID && !!limit && tokens >= limit
}

export function shouldShowTurnError(errorName: string, contextLimitVisible = false) {
  return errorName !== "ContextOverflowError" || !contextLimitVisible
}

export function ContextUsageWarning(props: {
  tokens: number
  limit: number
  locale: string
  disabled: boolean
  onIgnore: () => void
  onCompact: () => void
}) {
  return (
    <section class="make-context-warning" role="status" aria-label="上下文超出提示">
      <div class="make-context-warning-title">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="M8.27 3a2 2 0 0 1 3.46 0l6.06 10.5a2 2 0 0 1-1.73 3H3.94a2 2 0 0 1-1.73-3L8.27 3Z" fill="currentColor" />
          <path d="M10 6.25v4.5M10 13.5v.25" stroke="white" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <h2>上下文超出提示</h2>
      </div>
      <p class="make-context-warning-copy">
        当前对话 Session 上下文已超过80% ({props.tokens.toLocaleString(props.locale)} /{" "}
        {props.limit.toLocaleString(props.locale)})，建议点击“上下文压缩”以继续对话。
      </p>
      <div class="make-context-warning-actions">
        <button type="button" class="make-context-warning-ignore" onClick={props.onIgnore}>
          忽略
        </button>
        <button
          type="button"
          class="make-context-warning-compact"
          disabled={props.disabled}
          onClick={props.onCompact}
        >
          上下文压缩
        </button>
      </div>
    </section>
  )
}
