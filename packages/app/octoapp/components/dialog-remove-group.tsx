import { onMount, type JSX } from "solid-js"
import "../pages/make/make-model-risk-dialog.css"

export function DialogRemoveGroup(props: {
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
    <div class="make-model-risk-overlay">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-group-risk-title"
        class="make-model-risk-dialog"
        onKeyDown={handleKeyDown}
      >
        <header class="make-model-risk-header">
          <div class="make-model-risk-heading">
            <img src="/make_risk_info.svg" class="make-model-risk-icon" alt="" />
            <h2 id="remove-group-risk-title" class="make-model-risk-title">确定移除该分组吗</h2>
          </div>
          <button type="button" class="make-model-risk-close" aria-label="关闭" onClick={props.onCancel}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="make-model-risk-content">
          移除后，分组将从列表中消失，分组内的对话将被删除，此操作不可撤销。
        </div>
        <footer class="make-model-risk-actions">
          <button type="button" class="make-model-risk-button make-model-risk-button-cancel" onClick={props.onCancel}>
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            class="make-model-risk-button make-model-risk-button-confirm"
            onClick={props.onConfirm}
          >
            移除
          </button>
        </footer>
      </section>
    </div>
  )
}
