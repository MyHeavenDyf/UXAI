import { onMount, type JSX } from "solid-js"
import { usePlatform } from "@/context/platform"
import "./make-model-risk-dialog.css"

const AI_MANAGEMENT_GUIDE_URL = "https://w3.huawei.com/info/cn/doc/viewDoc.do?did=18822293&cata348041"

function MakeModelRiskLink(props: { href: string; children: JSX.Element }): JSX.Element {
  const platform = usePlatform()
  return (
    <a
      href={props.href || undefined}
      target="_blank"
      rel="noopener noreferrer"
      class="make-model-risk-link"
      onClick={(event) => {
        if (!props.href) return
        event.preventDefault()
        platform.openLink(props.href)
      }}
    >
      {props.children}
    </a>
  )
}

export function MakeModelRiskDialog(props: { onCancel: () => void; onConfirm: () => void }): JSX.Element {
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
        aria-labelledby="make-model-risk-title"
        class="make-model-risk-dialog"
        onKeyDown={handleKeyDown}
      >
        <header class="make-model-risk-header">
          <div class="make-model-risk-heading">
            <img src="/make_risk_info.svg" class="make-model-risk-icon" alt="" />
            <h2 id="make-model-risk-title" class="make-model-risk-title">信息风险提示</h2>
          </div>
          <button
            type="button"
            class="make-model-risk-close"
            aria-label="关闭"
            onClick={props.onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="make-model-risk-content">
        请遵守
          <MakeModelRiskLink href={AI_MANAGEMENT_GUIDE_URL}>《业务生产与办公生成式人工智能管理指引》</MakeModelRiskLink>
          ，按公司要求不能向外部网站上传内部文档、内部代码及内部信息。
        </div>
        <footer class="make-model-risk-actions">
          <button
            type="button"
            class="make-model-risk-button make-model-risk-button-cancel"
            onClick={props.onCancel}
          >
            稍后再试
          </button>
          <button
            ref={confirmRef}
            type="button"
            class="make-model-risk-button make-model-risk-button-confirm"
            onClick={props.onConfirm}
          >
            我已知晓
          </button>
        </footer>
      </section>
    </div>
  )
}
