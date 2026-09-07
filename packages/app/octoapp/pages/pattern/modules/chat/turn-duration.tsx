import { createEffect, createSignal, onCleanup, untrack, Show, type JSX } from "solid-js"

export function TurnDuration(props: {
  startTime: number
  endTime?: number
  active: boolean
  pauseMs: number
  pauseStartedAt?: number
}): JSX.Element {
  const [duration, setDuration] = createSignal("")

  // 判断 round 是否真正完成：endTime 已定义才算
  const isRoundDone = () => props.endTime !== undefined && !props.active && props.pauseStartedAt === undefined

  const fmt = () => {
    let totalPaused = props.pauseMs
    if (props.pauseStartedAt !== undefined) totalPaused += Date.now() - props.pauseStartedAt
    // 暂停态也用 Date.now() 做 end，这样 end - totalPaused 正好抵消为 pauseStartedAt
    let end: number
    if (isRoundDone()) {
      // 已真正完成：用 props.endTime，避免 fallback 到 Date.now() 导致"距开始已多久"那种错误展示
      end = props.endTime!
    } else {
      end = Date.now()
    }
    const secs = Math.max(0, Math.round((end - props.startTime - totalPaused) / 1000))
    const m = Math.floor(secs / 60)
    const s = secs % 60
    setDuration(`用时${m > 0 ? `${m}m ` : ""}${secs < 10 ? s : String(s).padStart(2, "0")}s`)
  }

  let timer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    // 仅追踪 active / pauseStartedAt / endTime 这几个关键状态，避免流式 props 抖动反复重跑
    if (isRoundDone()) {
      untrack(fmt)
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    } else {
      // 还没真正完成（可能 active=true 也可能 active 短暂 false 但 endTime 还没回填）：
      // 保持计时器运行，不要中途清掉
      if (!timer) {
        untrack(fmt)
        timer = setInterval(() => untrack(fmt), 1000)
      }
    }
    onCleanup(() => {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    })
  })

  return (
    <Show when={duration()}>
      <div class="turn-duration">{duration()}</div>
    </Show>
  )
}