import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { createStore } from "solid-js/store"
import { UpdateDescription } from "./update-description"

const MAC_DOWNLOAD_PAGE_URL = "https://octo.hdesign.huawei.com/design/agentdesktop/mac-download.html"

export function useUpdateAvailableDialog() {
  const dialog = useDialog()
  const platform = usePlatform()

  return (version: string, releaseNotes?: string, onClose?: () => void, forceUpdate = false) =>
    dialog.show(
      () => (
        <DialogUpdateAvailable
          os={platform.os === "macos" ? "macos" : "windows"}
          version={version}
          releaseNotes={releaseNotes}
          forceUpdate={forceUpdate}
          onUpgrade={(onProgress) => {
            if (platform.os === "macos") {
              platform.openLink(MAC_DOWNLOAD_PAGE_URL)
              return
            }
            return platform.updateAndRestart?.(onProgress)
          }}
        />
      ),
      onClose,
      { dismissible: !forceUpdate },
    )
}

export function DialogUpdateAvailable(props: {
  os: "windows" | "macos"
  version: string
  releaseNotes?: string
  forceUpdate?: boolean
  onUpgrade: (onProgress: (percent: number) => void) => void | Promise<void>
}) {
  const dialog = useDialog()
  const [state, setState] = createStore({ downloading: false, progress: 0, error: "" })
  const setProgress = (percent: number) => setState("progress", percent)
  const upgrade = () => {
    if (props.os === "macos") {
      if (!props.forceUpdate) dialog.close()
      void props.onUpgrade(setProgress)
      return
    }
    if (state.downloading) return
    setState({ downloading: true, error: "" })
    void Promise.resolve().then(() => props.onUpgrade(setProgress)).catch((error: unknown) => {
      setState({ downloading: false, error: error instanceof Error ? error.message : "更新失败，请重试。" })
    })
  }

  return (
    <Dialog fit class="octo-update-dialog">
      <section class="octo-update-dialog-hero">
        <img src="/update-dialog-hero.png" alt="Octo Agent" />
        {!props.forceUpdate && (
          <button type="button" class="octo-update-dialog-close" aria-label="关闭" onClick={() => dialog.close()}>
            ×
          </button>
        )}
      </section>

      <section class="octo-update-dialog-content">
        <h2>检测到更新（v{props.version.replace(/^v/i, "")}）</h2>
        <UpdateDescription releaseNotes={props.releaseNotes} />
        {state.error && <p role="alert" class="octo-update-dialog-error">{state.error}</p>}
        {state.downloading && (
          <div class="octo-update-dialog-progress">
            <div>
              <span>正在下载更新</span>
              <span>{Math.round(state.progress)}%</span>
            </div>
            <div class="octo-update-dialog-progress-track">
              <div style={{ width: `${Math.max(0, Math.min(100, state.progress))}%` }} />
            </div>
          </div>
        )}
        <div class="octo-update-dialog-actions" data-os={props.os} data-forced={props.forceUpdate ? true : undefined} data-progress={state.downloading ? true : undefined}>
          {props.os === "windows" && !props.forceUpdate && (
            <button type="button" class="octo-update-dialog-later" disabled={state.downloading} onClick={() => dialog.close()}>
              以后再说
            </button>
          )}
          <button type="button" class="octo-update-dialog-upgrade" disabled={state.downloading} onClick={upgrade}>
            {state.downloading ? `下载中 ${Math.round(state.progress)}%` : state.error ? "重试下载" : "立即升级"}
          </button>
        </div>
      </section>

      <style>{`
        body:has(.octo-update-dialog) [data-component="dialog-overlay"],
        [data-component="dialog"]:has(.octo-update-dialog),
        [data-component="dialog"]:has(.octo-update-dialog) [data-slot="dialog-container"],
        .octo-update-dialog-close {
          z-index: 19900 !important;
        }
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
          overflow: hidden;
        }
        .octo-update-dialog-hero > img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .octo-update-dialog-close {
          position: absolute;
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
        .octo-update-dialog-actions {
          display: flex;
          gap: 12px;
          margin-top: 40px;
        }
        .octo-update-dialog-progress {
          margin-top: 28px;
        }
        .octo-update-dialog-error {
          margin: 16px 0 0;
          font-size: 13px;
          line-height: 20px;
          color: #b42318;
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
        .octo-update-dialog-actions[data-os="macos"],
        .octo-update-dialog-actions[data-forced] {
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
