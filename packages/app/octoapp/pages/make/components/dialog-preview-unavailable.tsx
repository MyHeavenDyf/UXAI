import type { JSX } from "solid-js"
import { Show, createSignal } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"
import { fetchArtifactContent } from "../utils/artifact-file-api"
import { directoryHeader } from "@/utils/headers"

interface Props {
  filename: string
  filePath?: string
  sdkUrl: string
  sdkDirectory: string
}

export function DialogPreviewUnavailable(props: Props): JSX.Element {
  const dialog = useDialog()
  const [downloading, setDownloading] = createSignal(false)

  async function handleDownload() {
    if (downloading()) return
    if (!props.filePath) {
      showToast({ title: "下载失败", description: "文件路径缺失" })
      return
    }
    setDownloading(true)
    try {
      const content = await fetchArtifactContent(props.sdkUrl, props.sdkDirectory, props.filePath)
      const blob = content.encoding === "base64"
        ? await fetch(`data:${content.mimeType || "application/octet-stream"};base64,${content.content}`).then((r) => r.blob())
        : new Blob([content.content], { type: content.mimeType || "application/octet-stream" })

      const api = (window as any).api
      if (api?.saveFilePicker && api?.writeFileBuffer) {
        const chosen = await api.saveFilePicker({ defaultPath: props.filename })
        if (!chosen) return
        await api.writeFileBuffer(chosen, await blob.arrayBuffer())
        showToast({ title: "下载完成", description: props.filename })
        tracker.interaction({ module: "design", name: "files-download-file" })
        return
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = props.filename
      a.click()
      URL.revokeObjectURL(url)
      showToast({ title: "下载完成", description: props.filename })
      tracker.interaction({ module: "design", name: "files-download-file" })
    } catch (err) {
      showToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog
      fit
      class="preview-unavailable-dialog"
      style={{
        width: "608px",
        padding: "24px",
        "border-radius": "12px",
        "box-shadow": "0px 16px 48px 0px rgba(0,0,0,0.16)",
        "font-family": "HarmonyOS Sans SC, var(--font-family-sans)",
        "background-color": "#fff",
      }}
    >
      {/* 顶部:文件名(左)+ 关闭按钮(右) */}
      <div class="flex items-start justify-between gap-3">
        <span
          style={{
            "font-size": "16px",
            "font-weight": 500,
            "line-height": "24px",
            color: "rgba(0,0,0,0.9)",
            "word-break": "break-all",
            flex: 1,
            "min-width": 0,
          }}
        >
          {props.filename}
        </span>
        <button
          type="button"
          onClick={() => dialog.close()}
          aria-label="关闭"
          style={{
            width: "16px",
            height: "16px",
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            "flex-shrink": 0,
            "margin-top": "4px",
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="rgba(0,0,0,0.9)"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      {/* 居中内容 */}
      <div class="flex flex-col items-center" style={{ "margin-top": "40px" }}>
        <div
          style={{
            "font-size": "14px",
            color: "rgba(0,0,0,0.9)",
            "line-height": "22px",
            "text-align": "center",
          }}
        >
          预览不可用。
        </div>
        <div
          style={{
            "font-size": "14px",
            color: "rgba(0,0,0,0.6)",
            "line-height": "22px",
            "text-align": "center",
            "word-break": "break-all",
            "max-width": "100%",
          }}
        >
          {props.filename}
        </div>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloading()}
          style={{
            width: "88px",
            "text-align": "center",
            "line-height": "30px",
            "border-radius": "999px",
            border: "1px solid rgb(201, 201, 201)",
            color: "rgb(25, 25, 25)",
            "margin-top": "16px",
            "margin-bottom": "24px",
            background: "#fff",
            cursor: downloading() ? "not-allowed" : "pointer",
            "font-size": "14px",
            "font-family": "inherit",
            opacity: downloading() ? 0.6 : 1,
          }}
        >
          {downloading() ? "下载中" : "下载"}
        </button>
      </div>
    </Dialog>
  )
}
