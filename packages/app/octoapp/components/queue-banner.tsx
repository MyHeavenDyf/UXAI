import { For } from "solid-js"

export function QueueBanner(props: {
  items: { text: string }[]
  onRemove: (index: number) => void
}) {
  return (
    <div class="octo-queue-banner">
      <span class="octo-queue-banner-label">排队中 {props.items.length}</span>
      <div class="octo-queue-banner-list">
        <For each={props.items}>
          {(item, i) => (
            <div class="octo-queue-banner-item">
              <span class="octo-queue-banner-index">{i() + 1}</span>
              <span class="octo-queue-banner-text">{item.text}</span>
              <button
                type="button"
                onClick={() => props.onRemove(i())}
                class="octo-queue-banner-cancel"
                title="移除这条"
                aria-label="移除排队项"
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
