import { onMount, type JSX } from "solid-js"
import { usePlatform } from "@/context/platform"

const AI_MANAGEMENT_GUIDE_URL = "https://w3.huawei.com/info/cn/doc/viewDoc.do?did=18822293&cata348041"
const SEEDANCE_TERMS_URL = "https://docs.byteplus.com/zh-CN/docs/legal/docs-terms-of-service"
const EXTERNAL_AI_WEBSITE_CASE_URL = "https://12345.huawei.com/unidesk/portal/#/case_details?caseId=KT00231963"

function StudioVideoRiskLink(props: { href: string; children: JSX.Element }): JSX.Element {
  const platform = usePlatform()
  return (
    <a
      href={props.href || undefined}
      target="_blank"
      rel="noopener noreferrer"
      class="studio-video-risk-link"
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

export function StudioVideoRiskContent(props: { class: string }): JSX.Element {
  return (
    <div class={props.class}>
      请遵守
      <StudioVideoRiskLink href={AI_MANAGEMENT_GUIDE_URL}>
        《业务生产与办公生成式人工智能管理指引》
      </StudioVideoRiskLink>
      ，按公司要求不能向外部网站上传内部文档、内部代码及内部信息；关于生成物版权请查看
      <StudioVideoRiskLink href={SEEDANCE_TERMS_URL}>
        《Seedance服务专用条款》
      </StudioVideoRiskLink>
    </div>
  )
}

function StudioVideoRiskDialogContent(): JSX.Element {
  return (
    <div class="studio-video-risk-content">
      <div class="studio-video-risk-greeting">致在创意前线的先锋用户：</div>
      <div class="studio-video-risk-message">
        请在访问过程中注意避免公司信息资产泄漏，并避免未经评估将生成内容直接用于输出件中。请遵守
        <StudioVideoRiskLink href={AI_MANAGEMENT_GUIDE_URL}>
          《业务生产与办公生成式人工智能管理指引》
        </StudioVideoRiskLink>
        发文要求，参考案例：
        <StudioVideoRiskLink href={EXTERNAL_AI_WEBSITE_CASE_URL}>
          访问外部生成式人工智能网站需要注意哪些？
        </StudioVideoRiskLink>
      </div>
    </div>
  )
}

export function StudioVideoRiskDialog(props: {
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
    <div class="studio-video-risk-overlay">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-video-risk-title"
        class="studio-video-risk-dialog"
        onKeyDown={handleKeyDown}
      >
        <header class="studio-video-risk-header">
          <div class="studio-video-risk-heading">
            <img src="/studio/studio_risk_info.svg" class="studio-video-risk-icon" alt="" />
            <h2 id="studio-video-risk-title" class="studio-video-risk-title">信息风险提示</h2>
          </div>
          <button
            type="button"
            class="studio-video-risk-close"
            aria-label="关闭"
            onClick={props.onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <StudioVideoRiskDialogContent />
        <footer class="studio-video-risk-actions">
          <button type="button" class="studio-video-risk-button studio-video-risk-button-cancel" onClick={props.onCancel}>
            稍后再试
          </button>
          <button
            ref={confirmRef}
            type="button"
            class="studio-video-risk-button studio-video-risk-button-confirm"
            onClick={props.onConfirm}
          >
            已知悉
          </button>
        </footer>
      </section>
    </div>
  )
}
