import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal } from "solid-js"

export const MAC_UPDATE_DOWNLOAD_URL = "https://github.com/anomalyco/octo-agent/releases/latest"

export function DialogUpdateAvailable(props: {
  os: "windows" | "macos"
  version: string
  onUpgrade: (onProgress: (percent: number) => void) => void | Promise<void>
}) {
  const dialog = useDialog()
  const [downloading, setDownloading] = createSignal(false)
  const [progress, setProgress] = createSignal(0)
  const [failed, setFailed] = createSignal(false)
  const version = () => props.version.replace(/^v/i, "")
  const upgrade = () => {
    if (props.os === "macos") {
      dialog.close()
      void props.onUpgrade(setProgress)
      return
    }
    if (downloading()) return
    setDownloading(true)
    setFailed(false)
    void Promise.resolve(props.onUpgrade(setProgress)).catch(() => {
      setDownloading(false)
      setFailed(true)
    })
  }

  return (
    <Dialog fit class="octo-update-dialog">
      <section class="octo-update-dialog-hero">
        <button type="button" class="octo-update-dialog-close" aria-label="关闭" onClick={() => dialog.close()}>
          ×
        </button>
        <div class="octo-update-dialog-brand">
          <img src="/OctoLogo.svg" alt="" />
          <span>Octo Agent</span>
        </div>
      </section>

      <section class="octo-update-dialog-content">
        <h2>检测到更新</h2>
        <p>
          V {version()} 版本全新升级！我们大幅提升了 AI 的意图理解力，现在不仅能用提示词秒级生成高保真 UI，还支持圈选局部精准重绘与自动图层分组，让你的设计灵感即刻落地。
        </p>
        {downloading() && (
          <div class="octo-update-dialog-progress">
            <div>
              <span>正在下载更新</span>
              <span>{Math.round(progress())}%</span>
            </div>
            <div class="octo-update-dialog-progress-track">
              <div style={{ width: `${Math.max(0, Math.min(100, progress()))}%` }} />
            </div>
          </div>
        )}
        <div class="octo-update-dialog-actions" data-os={props.os} data-progress={downloading() ? true : undefined}>
          {props.os === "windows" && (
            <button type="button" class="octo-update-dialog-later" disabled={downloading()} onClick={() => dialog.close()}>
              以后再说
            </button>
          )}
          <button type="button" class="octo-update-dialog-upgrade" disabled={downloading()} onClick={upgrade}>
            {downloading() ? `下载中 ${Math.round(progress())}%` : failed() ? "重试下载" : "立即升级"}
          </button>
        </div>
      </section>

      <style>{`
        .octo-update-dialog {
          width: min(calc(100vw - 32px), 500px) !important;
          min-height: 0 !important;
          align-self: center !important;
          overflow: hidden !important;
          border-radius: 12px !important;
          background: #fff !important;
        }
        .octo-update-dialog-hero {
          position: relative;
          height: 240px;
          flex: none;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(circle at 30% 28%, rgba(151, 239, 255, 0.95), transparent 29%),
            radial-gradient(circle at 75% 58%, rgba(19, 153, 255, 0.9), transparent 34%),
            linear-gradient(125deg, #78d8f5 0%, #e3ecff 43%, #39b8ed 72%, #0989d5 100%);
          overflow: hidden;
        }
        .octo-update-dialog-hero::before,
        .octo-update-dialog-hero::after {
          content: "";
          position: absolute;
          width: 420px;
          height: 100px;
          border-radius: 50%;
          filter: blur(18px);
          transform: rotate(-24deg);
        }
        .octo-update-dialog-hero::before {
          top: 26px;
          left: -76px;
          background: rgba(255, 255, 255, 0.48);
        }
        .octo-update-dialog-hero::after {
          right: -90px;
          bottom: 10px;
          background: rgba(0, 119, 222, 0.32);
        }
        .octo-update-dialog-close {
          position: absolute;
          z-index: 2;
          top: 16px;
          right: 18px;
          width: 28px;
          height: 28px;
          padding: 0;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: rgba(0, 0, 0, 0.9);
          font-size: 24px;
          line-height: 25px;
          font-weight: 300;
          cursor: pointer;
        }
        .octo-update-dialog-close:hover {
          background: rgba(255, 255, 255, 0.35);
        }
        .octo-update-dialog-brand {
          position: relative;
          z-index: 1;
          width: 206px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 999px;
          background: linear-gradient(105deg, rgba(255, 255, 255, 0.28), rgba(111, 214, 255, 0.64));
          box-shadow: inset 0 0 18px rgba(255, 255, 255, 0.45), 0 8px 24px rgba(28, 119, 205, 0.18);
          backdrop-filter: blur(8px);
          color: #fff;
          font-size: 22px;
          line-height: 28px;
          font-weight: 600;
        }
        .octo-update-dialog-brand img {
          width: 26px;
          height: 24px;
        }
        .octo-update-dialog-content {
          box-sizing: border-box;
          padding: 40px 32px;
          color: rgba(0, 0, 0, 0.9);
        }
        .octo-update-dialog-content h2 {
          margin: 0;
          font-size: 16px;
          line-height: 24px;
          font-weight: 700;
        }
        .octo-update-dialog-content p {
          margin: 12px 0 0;
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
        }
        .octo-update-dialog-actions {
          display: flex;
          gap: 12px;
          margin-top: 40px;
        }
        .octo-update-dialog-progress {
          margin-top: 28px;
        }
        .octo-update-dialog-progress > div:first-child {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          color: rgba(0, 0, 0, 0.65);
          font-size: 13px;
          line-height: 20px;
        }
        .octo-update-dialog-progress-track {
          height: 6px;
          overflow: hidden;
          border-radius: 999px;
          background: #e9edf5;
        }
        .octo-update-dialog-progress-track > div {
          height: 100%;
          border-radius: inherit;
          background: #0a59f7;
          transition: width 160ms ease-out;
        }
        .octo-update-dialog-actions[data-progress] {
          margin-top: 24px;
        }
        .octo-update-dialog-actions[data-os="macos"] {
          justify-content: center;
        }
        .octo-update-dialog-actions button {
          height: 42px;
          border: 0;
          border-radius: 999px;
          font-size: 16px;
          line-height: 22px;
          cursor: pointer;
        }
        .octo-update-dialog-actions button:disabled {
          cursor: default;
          opacity: 0.65;
        }
        .octo-update-dialog-later,
        .octo-update-dialog-upgrade {
          flex: 1;
        }
        .octo-update-dialog-actions[data-os="macos"] .octo-update-dialog-upgrade {
          max-width: 328px;
        }
        .octo-update-dialog-later {
          background: #f3f3f3;
          color: rgba(0, 0, 0, 0.9);
        }
        .octo-update-dialog-later:hover {
          background: #e9e9e9;
        }
        .octo-update-dialog-upgrade {
          background: #0a59f7;
          color: #fff;
        }
        .octo-update-dialog-upgrade:hover {
          background: #064ee0;
        }
      `}</style>
    </Dialog>
  )
}
