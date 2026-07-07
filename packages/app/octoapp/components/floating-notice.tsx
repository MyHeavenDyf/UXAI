import "./floating-notice.css"
import { createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"

export type FloatingNoticeType = "info" | "success" | "warning" | "error"

type FloatingNoticeState = {
  type: FloatingNoticeType
  message: string
  key: number
}

const [notice, setNotice] = createSignal<FloatingNoticeState>()
let hideTimer: number | undefined

export function showFloatingNotice(type: FloatingNoticeType, message: string) {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  setNotice({ type, message, key: Date.now() })
  hideTimer = window.setTimeout(() => {
    setNotice(undefined)
    hideTimer = undefined
  }, 3_000)
}

export function FloatingNotice(props: { type: FloatingNoticeType; message: string }) {
  return (
    <div class="floating-notice" role="status" aria-live="polite">
      <span class={`floating-notice-icon ${props.type}`} aria-hidden="true">
        {iconText(props.type)}
      </span>
      <span class="floating-notice-message">{props.message}</span>
    </div>
  )
}

export function FloatingNoticeHost() {
  onCleanup(() => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  })
  return (
    <Portal>
      <Show when={notice()} keyed>
        {(item) => (
          <div class="floating-notice-region" data-key={item.key}>
            <FloatingNotice type={item.type} message={item.message} />
          </div>
        )}
      </Show>
    </Portal>
  )
}

function iconText(type: FloatingNoticeType) {
  if (type === "success") return "✓"
  if (type === "warning") return "!"
  if (type === "error") return "!"
  return "i"
}
