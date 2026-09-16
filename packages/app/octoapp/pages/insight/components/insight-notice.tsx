import "./insight-notice.css"
import { createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"

type InsightNoticeType = "info" | "success" | "warning" | "error"

type InsightNoticeState = {
  type: InsightNoticeType
  message: string
  key: number
}

const [notice, setNotice] = createSignal<InsightNoticeState>()
let hideTimer: number | undefined

export function showInsightNotice(type: InsightNoticeType, message: string) {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  const key = Date.now()
  setNotice({ type, message, key })
  hideTimer = window.setTimeout(() => {
    setNotice((current) => (current?.key === key ? undefined : current))
    hideTimer = undefined
  }, 3000)
}

function iconText(type: InsightNoticeType) {
  if (type === "success") return "✓"
  if (type === "warning" || type === "error") return "!"
  return "i"
}

export function InsightNoticeHost() {
  onCleanup(() => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  })
  return (
    <Portal>
      <Show when={notice()} keyed>
        {(item) => (
          <div class="insight-notice-region" data-key={item.key}>
            <div class="insight-notice" role="status" aria-live="polite">
              <span class={`insight-notice-icon ${item.type}`} aria-hidden="true">
                {iconText(item.type)}
              </span>
              <span class="insight-notice-message">{item.message}</span>
            </div>
          </div>
        )}
      </Show>
    </Portal>
  )
}
