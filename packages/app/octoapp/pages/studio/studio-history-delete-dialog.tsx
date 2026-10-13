import { onMount, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"

export function StudioHistoryDeleteDialog(props: {
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const language = useLanguage()
  let dialogRef!: HTMLElement
  let confirmRef!: HTMLButtonElement

  onMount(() => confirmRef.focus())

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      props.onCancel()
      return
    }
    if (event.key !== "Tab") return
    const buttons = Array.from(dialogRef.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
    const first = buttons[0]
    const last = buttons.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div class="studio-history-delete-overlay">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-history-delete-title"
        class="studio-history-delete-dialog"
        onKeyDown={handleKeyDown}
      >
        <header class="studio-history-delete-header">
          <div class="studio-history-delete-heading">
            <img src="/studio/studio_risk_info.svg" class="studio-history-delete-icon" alt="" />
            <h2 id="studio-history-delete-title" class="studio-history-delete-title">{language.t("studio.history.delete.title")}</h2>
          </div>
          <button
            type="button"
            class="studio-history-delete-close"
            aria-label={language.t("common.close")}
            onClick={props.onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="studio-history-delete-content">
          {language.t("studio.history.delete.message")}
        </div>
        <footer class="studio-history-delete-actions">
          <button
            type="button"
            class="studio-history-delete-button studio-history-delete-button-cancel"
            onClick={props.onCancel}
          >
            {language.t("common.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            class="studio-history-delete-button studio-history-delete-button-confirm"
            onClick={props.onConfirm}
          >
            {language.t("common.delete")}
          </button>
        </footer>
      </section>
    </div>
  )
}
