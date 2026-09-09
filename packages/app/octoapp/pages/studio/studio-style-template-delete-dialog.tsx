import { onMount, type JSX } from "solid-js"

export function StudioStyleTemplateDeleteDialog(props: {
  deleting: boolean
  templateTitle: string
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  let dialogRef!: HTMLElement
  let confirmRef!: HTMLButtonElement

  onMount(() => confirmRef.focus())

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
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
    <div class="studio-style-template-delete-overlay">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-style-template-delete-title"
        aria-describedby="studio-style-template-delete-description"
        class="studio-style-template-delete-dialog"
        onKeyDown={handleKeyDown}
      >
        <div class="studio-style-template-delete-content">
          <img src="/studio/studio_risk_info.svg" class="studio-style-template-delete-icon" alt="" />
          <div class="studio-style-template-delete-copy">
            <h2 id="studio-style-template-delete-title" class="studio-style-template-delete-title">
              确定删除 “{props.templateTitle}” 模版吗？
            </h2>
            <p id="studio-style-template-delete-description" class="studio-style-template-delete-description">
              删除操作无法撤回，请慎重选择
            </p>
          </div>
        </div>
        <footer class="studio-style-template-delete-actions">
          <button
            type="button"
            class="studio-style-template-delete-button cancel"
            disabled={props.deleting}
            onClick={props.onCancel}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            class="studio-style-template-delete-button confirm"
            disabled={props.deleting}
            onClick={props.onConfirm}
          >
            {props.deleting ? "删除中..." : "确认"}
          </button>
        </footer>
      </section>
    </div>
  )
}
