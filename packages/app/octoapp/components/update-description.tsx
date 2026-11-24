import { createEffect, createSignal, onCleanup } from "solid-js"

export function UpdateDescription(props: { releaseNotes?: string }) {
  const releaseNotes = () => props.releaseNotes?.trim()
  const [element, setElement] = createSignal<HTMLParagraphElement>()
  const [hasMore, setHasMore] = createSignal(false)
  const updateOverflow = () => {
    const current = element()
    setHasMore(Boolean(current && current.scrollHeight - current.clientHeight - current.scrollTop > 1))
  }

  createEffect(() => {
    releaseNotes()
    const current = element()
    if (!current) return
    const frame = requestAnimationFrame(updateOverflow)
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(current)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    })
  })

  return (
    <>
      {releaseNotes() ? (
        <p
          ref={setElement}
          class="octo-update-dialog-description"
          data-has-more={hasMore() ? true : undefined}
          onScroll={updateOverflow}
          tabIndex={0}
          aria-label="更新说明"
        >{releaseNotes()}</p>
      ) : (
        <div class="octo-update-dialog-description-spacer" aria-hidden="true" />
      )}
      <style>{`
        .octo-update-dialog-description {
          margin: 12px 0 0;
          min-height: 63px;
          max-height: 168px;
          overflow-y: auto;
          scrollbar-width: none;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
        }
        .octo-update-dialog-description::-webkit-scrollbar {
          display: none;
        }
        .octo-update-dialog-description[data-has-more] {
          -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 21px), transparent);
          mask-image: linear-gradient(to bottom, #000 calc(100% - 21px), transparent);
        }
        .octo-update-dialog-description-spacer {
          height: 75px;
        }
      `}</style>
    </>
  )
}
