import { createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"

export function StudioFullscreenImage(props: { src: string; mount?: () => HTMLElement; onClose: () => void }) {
  createEffect(() => {
    const mount = props.mount?.() ?? document.body
    const overflow = mount.style.overflow
    mount.style.overflow = "hidden"
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
    }
    document.addEventListener("keydown", keydown, true)
    onCleanup(() => {
      mount.style.overflow = overflow
      document.removeEventListener("keydown", keydown, true)
    })
  })

  return (
    <Portal mount={props.mount?.() ?? document.body}>
      <div
        class="studio-fullscreen-overlay"
        role="dialog"
        aria-label="图片预览"
        aria-modal="true"
        onClick={props.onClose}
      >
        <button
          type="button"
          class="studio-fullscreen-close"
          aria-label="关闭全屏"
          onClick={(event) => {
            event.stopPropagation()
            props.onClose()
          }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
        <img src={props.src} class="studio-fullscreen-image" alt="" />
      </div>
    </Portal>
  )
}
