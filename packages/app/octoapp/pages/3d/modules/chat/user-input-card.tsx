import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import "../../assets/style/chat/user-input-card.css"

export function UserInputCard(props: { text: string }): JSX.Element {
  const [userExpanded, setUserExpanded] = createSignal(false)
  const [contentOverflows, setContentOverflows] = createSignal(false)
  const [collapsedMaxHeight, setCollapsedMaxHeight] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  let bubbleContentRef: HTMLDivElement | undefined

  createEffect(() => {
    const text = props.text
    if (!bubbleContentRef) {
      setContentOverflows(false)
      setCollapsedMaxHeight("")
      return
    }
    const measure = () => {
      if (!bubbleContentRef) return
      const lineHeight = parseFloat(getComputedStyle(bubbleContentRef).lineHeight) || 22
      const fiveLineHeight = lineHeight * 5
      setCollapsedMaxHeight((prev) => {
        const val = `${fiveLineHeight}px`
        return prev === val ? prev : val
      })
      setContentOverflows((prev) => {
        const overflows = bubbleContentRef!.scrollHeight > fiveLineHeight + lineHeight * 0.3
        return prev === overflows ? prev : overflows
      })
    }
    const raf = requestAnimationFrame(measure)
    onCleanup(() => cancelAnimationFrame(raf))
  })

  const showCollapseBtn = createMemo(() => contentOverflows())

  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => { if (copyTimer) clearTimeout(copyTimer) })
  const handleCopy = () => {
    navigator.clipboard.writeText(props.text)
      .then(() => {
        setCopied(true)
        if (copyTimer) clearTimeout(copyTimer)
        copyTimer = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div class="flex justify-end px-3 py-2.5">
      <div class="flex flex-col items-end max-w-[85%]">
        <div
          class="user-bubble-wrapper"
          classList={{
            "user-bubble-collapsed": showCollapseBtn() && !userExpanded(),
            "user-bubble-expanded": showCollapseBtn() && userExpanded(),
          }}
        >
          <button type="button" class="user-bubble-copy-btn" onClick={handleCopy} title="复制">
            <Show when={copied()} fallback={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="5" width="8" height="8" rx="1.5" />
                <path d="M3 11V4a1 1 0 0 1 1-1h7" />
              </svg>
            }>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 8.5L6.5 12L13 4.5" />
              </svg>
            </Show>
          </button>
          <div class="text-sm whitespace-pre-wrap break-words leading-relaxed px-3 py-2 bubble-content">
            <div
              ref={bubbleContentRef}
              class="bubble-text-inner"
              style={showCollapseBtn() && !userExpanded() ? { "max-height": collapsedMaxHeight(), overflow: "hidden" } : undefined}
            >
              {props.text}
            </div>
          </div>
          <Show when={showCollapseBtn()}>
            <div class="user-bubble-toggle-wrap">
              <Show when={!userExpanded()}>
                <div class="user-bubble-fade" />
              </Show>
              <button
                type="button"
                class="user-bubble-toggle-btn"
                onClick={() => setUserExpanded((v) => !v)}
              >
                <Show when={userExpanded()} fallback={
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 10L8 6L12 10" />
                  </svg>
                }>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 6L8 10L12 6" />
                  </svg>
                </Show>
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
