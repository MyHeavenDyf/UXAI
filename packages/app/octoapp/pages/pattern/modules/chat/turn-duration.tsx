import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"

export function TurnDuration(props: {
  startTime: number
  endTime?: number
  active: boolean
}): JSX.Element {
  const [duration, setDuration] = createSignal("")

  const fmt = () => {
    // active 时始终用 Date.now() 实时计时，忽略部分 agent 的 endTime
    const end = props.active ? Date.now() : (props.endTime ?? Date.now())
    const secs = Math.max(0, Math.round((end - props.startTime) / 1000))
    const m = Math.floor(secs / 60)
    const s = secs % 60
    setDuration(`用时${m > 0 ? `${m}m ` : ""}${secs < 10 ? s : String(s).padStart(2, "0")}s`)
  }

  let timer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    if (props.active) {
      fmt()
      timer = setInterval(fmt, 1000)
    } else {
      fmt()
      if (timer) { clearInterval(timer); timer = undefined }
    }
    onCleanup(() => { if (timer) clearInterval(timer) })
  })

  return (
    <Show when={duration()}>
      <div class="turn-duration">{duration()}</div>
    </Show>
  )
}
