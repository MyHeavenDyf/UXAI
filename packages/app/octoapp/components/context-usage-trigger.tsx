import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ContextUsageCircle } from "./context-usage-circle"
import "./context-usage-trigger.css"

export function ContextUsageTrigger(props: {
  usage?: number
  tokens?: number
  limit?: number
  locale: string
  disabled: boolean
  onCompact: () => void
}) {
  return (
    <Tooltip
      placement="top"
      gutter={8}
      arrow
      interactive
      contentClass="octo-context-usage-tooltip"
      value={
        <p>
          当前对话 Session 上下文
          {props.usage === undefined ? "用量暂不可用" : `已使用${props.usage}%`}{" "}
          ({props.tokens?.toLocaleString(props.locale) ?? "--"}{" "}
          / {props.limit?.toLocaleString(props.locale) ?? "--"})
        </p>
      }
    >
      <button
        type="button"
        class="shrink-0 flex items-center justify-center"
        classList={{ "cursor-pointer": !props.disabled, "cursor-not-allowed": props.disabled }}
        style={{ "--border-weak-base": "rgba(0,0,0,0.1)", background: "transparent", border: "none", padding: "0" }}
        disabled={props.disabled}
        onClick={props.onCompact}
        aria-label={props.usage === undefined ? "上下文用量暂不可用，点击压缩上下文" : `上下文已使用 ${props.usage}%，点击压缩上下文`}
      >
        <ContextUsageCircle percentage={props.usage} />
      </button>
    </Tooltip>
  )
}
