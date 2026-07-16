import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"

export function TurnDuration(props: {
  startTime: number
  endTime?: number
  active: boolean
  pauseMs: number
  pauseStartedAt?: number
}): JSX.Element {
  const [duration, setDuration] = createSignal("")

  const fmt = () => {
    let totalPaused = props.pauseMs
    if (props.pauseStartedAt !== undefined) totalPaused += Date.now() - props.pauseStartedAt
    // 暂停态也用 Date.now() 做 end，这样 end - totalPaused 正好抵消为 pauseStartedAt
    const end = (props.active || props.pauseStartedAt !== undefined) ? Date.now() : (props.endTime ?? Date.now())
    const secs = Math.max(0, Math.round((end - props.startTime - totalPaused) / 1000))
    const m = Math.floor(secs / 60)
    const s = secs % 60
    setDuration(`用时${m > 0 ? `${m}m ` : ""}${secs < 10 ? s : String(s).padStart(2, "0")}s`)
  }

  let timer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    // generating 中、或停在确认页时都持续刷新
    if (props.active || props.pauseStartedAt !== undefined) {
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
