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
              <h3>归档成功</h3>
              <button type="button" class="dialog-close-btn" onClick={props.onClose}>
                ✕
              </button>
            </div>
            <div class="dialog-archive-success-body">
              <p class="archive-path-label">当前的文件已归档到</p>
              <p class="archive-path-value">{props.archivePath}</p>
              <p class="archive-hint">点击跳转可前往分享给开发</p>
            </div>
            <div class="dialog-archive-success-footer">
              <Show when={props.shareLink}>
                <button type="button" class="btn-secondary" onClick={handleCopyLink}>
                  复制链接
                </button>
              </Show>
              <button type="button" class="btn-primary" onClick={handleView}>
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
            box-shadow: var(--octo-shadow-lg);
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
            padding: 16px 20px;
            border-bottom: 1px solid var(--octo-border-default);
          }
          .dialog-archive-success-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--octo-text-primary);
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
            color: var(--octo-text-secondary);
            font-size: 16px;
            border-radius: 4px;
          }
          .dialog-close-btn:hover {
            background: var(--octo-surface-hover);
          }
          .dialog-archive-success-body {
            padding: 20px;
          }
          .archive-path-label {
            margin: 0 0 8px;
            font-size: 14px;
            color: var(--octo-text-secondary);
          }
          .archive-path-value {
            margin: 0 0 12px;
            font-size: 14px;
            color: var(--octo-text-primary);
            font-weight: 500;
            background: var(--octo-surface-subtle);
            padding: 8px 12px;
            border-radius: 6px;
          }
          .archive-hint {
            margin: 0;
            font-size: 13px;
            color: var(--octo-text-secondary);
          }
          .dialog-archive-success-footer {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            padding: 16px 20px;
            border-top: 1px solid var(--octo-border-default);
          }
          .btn-primary {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            background: #0a59f7;
            color: white;
          }
          .btn-primary:hover {
            opacity: 0.9;
          }
          .btn-secondary {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            background: #f2f2f2;
            color: var(--octo-text-primary);
          }
          .btn-secondary:hover {
            opacity: 0.9;
          }
        `}</style>
      </Portal>
    </Show>
  )
}