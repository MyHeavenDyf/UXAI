import { Show } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { showToast } from "@opencode-ai/ui/toast"

interface Props {
  open: boolean
  onClose: () => void
  archivePath: string
  shareLink?: string
  onViewClick?: () => void
}

export function DialogArchiveSuccess(props: Props): JSX.Element {
  const handleCopyLink = () => {
    if (props.shareLink) {
      navigator.clipboard.writeText(props.shareLink)
        .then(() => showToast({ title: "链接已复制" }))
        .catch(() => showToast({ title: "复制失败", variant: "error" }))
    } else {
      showToast({ title: "暂无分享链接" })
    }
  }

  const handleView = () => {
    props.onViewClick?.()
    props.onClose()
  }

  return (
    <Show when={props.open}>
      <Portal mount={document.body}>
        <div class="dialog-archive-success-overlay" onClick={props.onClose}>
          <div class="dialog-archive-success" onClick={(e) => e.stopPropagation()}>
            <div class="dialog-archive-success-header">
              <div class="dialog-archive-success-title">
                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none">
                  <path d="M8 0C3.5888 0 0 3.5888 0 8C0 12.4112 3.5888 16 8 16C12.4112 16 16 12.4112 16 8C16 3.5888 12.4112 0 8 0ZM7.60398 10.8041L12.404 6.00408C12.6303 5.77781 12.6303 5.42223 12.404 5.19596C12.1777 4.96969 11.8221 4.96969 11.5959 5.19596L7.19992 9.5919L4.80398 7.19596C4.5777 6.96969 4.22213 6.96969 3.99586 7.19596C3.76958 7.42223 3.76958 7.77781 3.99586 8.00408L6.79586 10.8041C6.93054 10.9388 7.06523 11.0061 7.19992 11.0061C7.3346 11.0061 7.46929 10.9388 7.60398 10.8041Z" fill="rgb(9,170,113)" fill-rule="evenodd" />
                </svg>
                <h3>归档成功</h3>
              </div>
              <button type="button" class="dialog-close-btn" onClick={props.onClose}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <div class="dialog-archive-success-body">
              <p class="archive-path-text">
                当前的文件已归档到【{props.archivePath}】
                <Show when={props.shareLink}>，点击跳转可前往分享给开发</Show>
              </p>
            </div>
            <div class="dialog-archive-success-footer">
              <Show when={props.shareLink}>
                <button type="button" class="dialog-btn-secondary" onClick={handleCopyLink}>
                  复制链接
                </button>
              </Show>
              <button type="button" class="dialog-btn-primary" onClick={handleView}>
                跳转查看
              </button>
            </div>
          </div>
        </div>
        <style>{`
          .dialog-archive-success-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }
          .dialog-archive-success {
            background: #ffffff;
            border-radius: 12px;
            width: 400px;
            max-width: 90vw;
            box-shadow: 0 16px 48px 0 rgba(0, 0, 0, 0.16);
            animation: dialog-slide-in 0.2s ease-out;
          }
          @keyframes dialog-slide-in {
            from {
              opacity: 0;
              transform: translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .dialog-archive-success-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 24px 0;
          }
          .dialog-archive-success-title {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .dialog-archive-success-title h3 {
            margin: 0;
            font-size: 14px;
            line-height: 22px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.9);
          }
          .dialog-close-btn {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: transparent;
            cursor: pointer;
            color: rgba(0, 0, 0, 0.6);
            border-radius: 4px;
          }
          .dialog-close-btn:hover {
            color: #0a59f7;
          }
          .dialog-archive-success-body {
            padding: 16px 24px;
          }
          .archive-path-text {
            margin: 0;
            font-size: 14px;
            line-height: 22px;
            color: rgba(0, 0, 0, 0.9);
          }
          .archive-path-value {
            color: rgba(0, 0, 0, 0.9);
            background: rgba(0, 0, 0, 0.03);
            padding: 2px 8px;
            border-radius: 4px;
          }
          .dialog-archive-success-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 8px 24px 24px;
          }
          .dialog-btn-primary {
            height: 32px;
            padding: 0 16px;
            min-width: 88px;
            border: none;
            border-radius: 999px;
            font-size: 14px;
            line-height: 22px;
            cursor: pointer;
            background: #0a59f7;
            color: white;
          }
          .dialog-btn-primary:hover {
            background: #0950de;
          }
          .dialog-btn-primary:active {
            background: #0a55eb;
          }
          .dialog-btn-secondary {
            height: 32px;
            padding: 0 16px;
            min-width: 88px;
            border: none;
            border-radius: 999px;
            font-size: 14px;
            line-height: 22px;
            cursor: pointer;
            background: #f3f3f3;
            color: #191919;
          }
          .dialog-btn-secondary:hover {
            background: #dfdfdf;
          }
          .dialog-btn-secondary:active {
            background: #dfdfdf;
          }
        `}</style>
      </Portal>
    </Show>
  )
}
