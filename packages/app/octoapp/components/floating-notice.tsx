import "./floating-notice.css"
import { createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"

export type FloatingNoticeType = "info" | "success" | "warning" | "error"
export type FloatingNoticeIcon = "default" | "loading"
export type FloatingNoticeAction = {
  label: string
  onClick: () => void
}
export type FloatingNoticeOptions = {
  type: FloatingNoticeType
  message: string
  icon?: FloatingNoticeIcon
  duration?: number
  action?: FloatingNoticeAction
}

type FloatingNoticeState = {
  type: FloatingNoticeType
  message: string
  icon?: FloatingNoticeIcon
  action?: FloatingNoticeAction
  key: number
}

const [notice, setNotice] = createSignal<FloatingNoticeState>()
let hideTimer: number | undefined

export function showFloatingNotice(type: FloatingNoticeType, message: string): () => void
export function showFloatingNotice(options: FloatingNoticeOptions): () => void
export function showFloatingNotice(input: FloatingNoticeType | FloatingNoticeOptions, message?: string) {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  const next = typeof input === "string"
    ? { type: input, message: message ?? "", icon: "default" as const, duration: 3_000 }
    : { icon: "default" as const, duration: 3_000, ...input }
  const key = Date.now()
  setNotice({ type: next.type, message: next.message, icon: next.icon, action: next.action, key })
  if (next.duration !== 0) {
    hideTimer = window.setTimeout(() => {
      setNotice((current) => current?.key === key ? undefined : current)
      hideTimer = undefined
    }, next.duration)
  } else {
    hideTimer = undefined
  }
  return () => {
    setNotice((current) => current?.key === key ? undefined : current)
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer)
      hideTimer = undefined
    }
  }
}

export function FloatingNotice(props: {
  type: FloatingNoticeType
  message: string
  icon?: FloatingNoticeIcon
  action?: FloatingNoticeAction
}) {
  return (
    <div class="floating-notice" role="status" aria-live="polite">
      <span class={`floating-notice-icon ${props.icon === "loading" ? "loading" : props.type}`} aria-hidden="true">
        <Show when={props.icon !== "loading"}>{iconText(props.type)}</Show>
      </span>
      <span class="floating-notice-message">{props.message}</span>
      <Show when={props.action}>
        {(action) => (
          <button type="button" class="floating-notice-action" onClick={action().onClick}>
            {action().label}
          </button>
        )}
      </Show>
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
            <FloatingNotice type={item.type} message={item.message} icon={item.icon} action={item.action} />
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
