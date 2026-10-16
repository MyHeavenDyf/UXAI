import "./share-notice.css"
import { createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"

type ShareNoticeState = { message: string; key: number }

const [notice, setNotice] = createSignal<ShareNoticeState>()
let hideTimer: number | undefined

function showShareNotice(message: string) {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  const key = Date.now()
  setNotice({ message, key })
  hideTimer = window.setTimeout(() => {
    setNotice((current) => (current?.key === key ? undefined : current))
    hideTimer = undefined
  }, 3_000)
}

export { showShareNotice }

export function ShareNoticeHost() {
  onCleanup(() => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  })
  return (
    <Portal>
      <Show when={notice()} keyed>
        {(item) => (
          <div class="share-notice-region" data-key={item.key}>
            <div class="share-notice" role="status" aria-live="polite">
              <span class="share-notice-icon" aria-hidden="true">✓</span>
              <span class="share-notice-message">{item.message}</span>
            </div>
          </div>
        )}
      </Show>
    </Portal>
  )
}
