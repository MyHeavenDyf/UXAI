export function shouldShowContextWarning(usage: number, sessionID?: string, ignoredSessionID?: string) {
  return !!sessionID && usage >= 80 && ignoredSessionID !== sessionID
}

export function isContextAtLimit(tokens: number, limit?: number, sessionID?: string) {
  return !!sessionID && !!limit && tokens >= limit
}

export function ContextUsageWarning(props: {
  tokens: number
  limit: number
  locale: string
  disabled: boolean
  compacting: boolean
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
          {props.compacting ? "压缩中…" : "上下文压缩"}
        </button>
      </div>
    </section>
  )
}

export function ContextUsageLimitWarning(props: {
  tokens: number
  limit: number
  locale: string
  disabled: boolean
  onCompact: () => void
}) {
  return (
    <section class="make-context-limit-warning" role="alert" aria-label="上下文已达到上限">
      <svg aria-hidden="true" viewBox="0 0 14 14">
        <path d="M5.79 2.1a1.4 1.4 0 0 1 2.42 0l4.24 7.35a1.4 1.4 0 0 1-1.21 2.1H2.76a1.4 1.4 0 0 1-1.21-2.1L5.79 2.1Z" fill="currentColor" />
        <path d="M7 4.3v3.15M7 9.38v.17" stroke="white" stroke-width="1.05" stroke-linecap="round" />
      </svg>
      <p>
        当前对话 Session 上下文已超过100% ({props.tokens.toLocaleString(props.locale)} /{" "}
        {props.limit.toLocaleString(props.locale)})。
        <br />
        请进行
        <button type="button" disabled={props.disabled} onClick={props.onCompact}>
          上下文压缩
        </button>
        ，或新建对话。
      </p>
    </section>
  )
}
