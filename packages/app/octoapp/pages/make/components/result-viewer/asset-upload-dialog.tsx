import { createSignal, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { assetUploadBaseUrl, sendFilesToAssetIframe, zipBlobToBase64 } from "../../utils/asset-upload"
import { showOctoToast } from "../octo-toast"
import { tracker } from "@/utils/tracker"
import "../addon-menu/styles.css"

/**
 * 保存到资产库上传弹窗（全页面 / 局部共用）。
 *
 *
 * - 确认：iframe onLoad 前禁用；点击后 onSavingChange(true)（下载按钮禁用 + hover「保存中」）
 *   → buildZip() → base64 → sendFilesToAssetIframe；成功 toast + 关闭；
 *   失败/超时 toast，弹窗保持打开可重试
 * - 取消 / X 关闭：onCancel（result-viewer 关闭弹窗 + 下载按钮退出激活态，
 *   局部变体同时退出元素选择模式）
 */
export type AssetUploadRequest = {
  variant: "full" | "partial"
  title: string
  /** postMessage files.name（全页面 = 页面名，局部 = 小弹窗 Input 值） */
  name: string
  /** 确认时构建 ZIP（全页面 = createHtmlAssetsZip；局部 = 元素 HTML + createPartialAssetsZip） */
  buildZip: () => Promise<Blob>
}

export function AssetUploadDialog(props: {
  request: AssetUploadRequest
  productId?: number
  saving?: boolean
  onSavingChange?: (saving: boolean) => void
  onCancel: () => void
  onSuccess: () => void
}): JSX.Element {
  const [iframeLoaded, setIframeLoaded] = createSignal(false)
  let iframeRef: HTMLIFrameElement | undefined

  const base = assetUploadBaseUrl()
  const uploadSrc = base && props.productId ? `${base}/agentPage/asset-upload/${props.productId}?ts=${Date.now()}` : ""

  /** 上传结果打点：每次确认尝试一个结果事件（成功数 / 尝试数 = 保存成功率） */
  const reportResult = (success: boolean, message?: string) =>
    tracker.interaction({
      module: "design",
      name: "save-to-asset-result",
      extend: JSON.stringify({
        variant: props.request.variant,
        success,
        ...(message ? { message: message.slice(0, 100) } : {}),
      }),
    })

  const handleConfirm = async () => {
    if (props.saving || !iframeRef) return
    props.onSavingChange?.(true)
    try {
      const zipBlob = await props.request.buildZip()
      const base64 = await zipBlobToBase64(zipBlob)
      const result = await sendFilesToAssetIframe(iframeRef, { name: props.request.name, base64 })
      if (result.success) {
        reportResult(true)
        showOctoToast({ title: "已保存到资产库" })
        props.onSuccess()
      } else {
        reportResult(false, result.message)
        showOctoToast({ title: "保存到资产库失败", description: result.message })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportResult(false, message)
      showOctoToast({ title: "保存到资产库失败", description: message })
    } finally {
      props.onSavingChange?.(false)
    }
  }

  return (
    <Portal>
      <div class="asset-dialog-overlay">
        <div class="library-dialog">
          {/* 标题栏 */}
          <div class="asset-dialog-title">
            <span class="asset-dialog-title-text">{props.request.title}</span>
            <button type="button" class="addon-menu-url-close asset-dialog-close" onClick={props.onCancel} aria-label="关闭">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          {/* iframe 区 */}
          <div class="library-dialog-iframe-area">
            <Show
              when={uploadSrc}
              fallback={
                <div
                  class="library-dialog-iframe"
                  style={{ display: "flex", "align-items": "center", "justify-content": "center", "font-size": "14px", color: "#777" }}
                >
                  请先选择关联产品的项目
                </div>
              }
            >
              <iframe
                ref={(el) => (iframeRef = el)}
                src={uploadSrc}
                class="library-dialog-iframe"
                title={props.request.title}
                onLoad={() => setIframeLoaded(true)}
              />
            </Show>
          </div>

          {/* 底部取消/确认（右下角）：胶囊形（共享类 asset-dialog-btn 被 LibraryDialog 使用，故内联覆盖样式） */}
          <div class="library-dialog-footer">
            <div class="asset-dialog-footer-actions">
              <button
                type="button"
                class="asset-dialog-btn"
                disabled={props.saving}
                onClick={props.onCancel}
                style={{
                  border: "none",
                  background: "rgba(0,0,0,0.05)",
                  "line-height": "32px",
                  width: "88px",
                  "border-radius": "999px",
                  color: "#191919",
                }}
              >
                取消
              </button>
              <button
                type="button"
                class="asset-dialog-btn asset-dialog-btn-primary"
                disabled={!iframeLoaded() || !!props.saving}
                onClick={() => void handleConfirm()}
                style={{
                  "line-height": "32px",
                  width: "88px",
                  "border-radius": "999px",
                }}
              >
                {props.saving ? "保存中..." : "确认"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
