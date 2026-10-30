import { Toast, toaster } from "@opencode-ai/ui/toast"
import { createStore } from "solid-js/store"

export type SessionTransferProgress = {
  type: "export" | "import" | "share"
  stage: string
  percent: number
  completed?: number
  total?: number
  processedBytes?: number
  totalBytes?: number
}

const size = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function showSessionTransferProgress(title: string) {
  const [state, setState] = createStore<SessionTransferProgress>({ type: "import", stage: "正在准备", percent: 0 })
  const id = toaster.show((toast) => (
    <Toast toastId={toast.toastId} persistent data-variant="loading" class="session-transfer-progress-toast">
      <Toast.Content style={{ width: "280px" }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
          <Toast.Title>{title}</Toast.Title>
          <span style={{ color: "var(--text-weak)", "font-size": "12px", "font-variant-numeric": "tabular-nums" }}>
            {Math.round(state.percent)}%
          </span>
        </div>
        <Toast.Description>{state.stage}</Toast.Description>
        <div
          role="progressbar"
          aria-label={state.stage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.percent)}
          style={{
            height: "4px",
            "margin-top": "10px",
            overflow: "hidden",
            "border-radius": "999px",
            background: "var(--background-stronger)",
          }}
        >
          <div
            style={{
              width: `${state.percent}%`,
              height: "100%",
              "border-radius": "inherit",
              background: "var(--icon-interactive-base)",
              transition: "width 160ms ease",
            }}
          />
        </div>
        <div style={{ "min-height": "18px", "margin-top": "6px", color: "var(--text-weak)", "font-size": "12px" }}>
          {state.totalBytes && state.processedBytes !== undefined
            ? `${size(state.processedBytes)} / ${size(state.totalBytes)}`
            : state.total && state.completed !== undefined
              ? `已处理 ${state.completed} / ${state.total} 个文件`
              : ""}
        </div>
      </Toast.Content>
    </Toast>
  ))
  return {
    update(progress: SessionTransferProgress) {
      setState({ ...progress, percent: Math.max(state.percent, Math.min(100, progress.percent)) })
    },
    dismiss() {
      toaster.dismiss(id)
    },
  }
}

export async function watchSessionTransferProgress(input: {
  url: string
  operationID: string
  fetch: typeof fetch
  headers?: HeadersInit
  signal: AbortSignal
  update: (progress: SessionTransferProgress) => void
}) {
  while (!input.signal.aborted) {
    await input
      .fetch(`${input.url.replace(/\/$/, "")}/session/portable-progress/${encodeURIComponent(input.operationID)}`, {
        headers: input.headers,
        signal: input.signal,
      })
      .then(async (response) => {
        if (!response.ok) return
        const progress: unknown = await response.json().catch(() => null)
        if (
          !progress ||
          typeof progress !== "object" ||
          !("percent" in progress) ||
          typeof progress.percent !== "number"
        )
          return
        input.update(progress as SessionTransferProgress)
      })
      .catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}
