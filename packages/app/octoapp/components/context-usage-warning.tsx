export function shouldShowContextWarning(usage: number, sessionID?: string, ignoredSessionID?: string) {
  return !!sessionID && usage >= 80 && ignoredSessionID !== sessionID
}

export function isContextAtLimit(tokens: number, limit?: number, sessionID?: string) {
  return !!sessionID && !!limit && tokens >= limit
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
