import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { createMemo } from "solid-js"

export function contextUsageState(percentage: number | null | undefined) {
  if ((percentage ?? 0) >= 80) return { level: "critical", color: "var(--icon-critical-base)" } as const
  if ((percentage ?? 0) >= 60) return { level: "warning", color: "var(--icon-warning-base)" } as const
  return { level: "normal", color: "var(--icon-interactive-base)" } as const
}

export function ContextUsageCircle(props: { percentage: number | null | undefined }) {
  const state = createMemo(() => contextUsageState(props.percentage))

  return (
    <span
      class="flex items-center justify-center"
      data-component="context-usage-circle"
      data-level={state().level}
      style={{ "--border-active": state().color }}
    >
      <ProgressCircle size={16} strokeWidth={2} percentage={props.percentage ?? 0} />
    </span>
  )
}
