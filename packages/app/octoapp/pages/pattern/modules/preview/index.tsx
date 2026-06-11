import { For, Show, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/persist"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
}

export function PreviewPage(props: {
  api?: PreviewPageAPI
  onPickerSubmit?: (text: string, domPickerId: string) => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
}) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined
  const [previewScale, setPreviewScale] = createSignal(1)
  const dialog = useDialog()

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  function updatePreviewScale() {
    if (!previewPageRef) return
    const containerWidth = previewPageRef.clientWidth - 40
    const containerHeight = previewPageRef.clientHeight - 40
    const scaleX = containerWidth / TARGET_WIDTH
    const scaleY = containerHeight / TARGET_HEIGHT
    setPreviewScale(Math.min(scaleX, scaleY, 1))
  }

  let previewResizeObserver: ResizeObserver | undefined
  onCleanup(() => previewResizeObserver?.disconnect())

  function bindpreviewPageRef(el: HTMLDivElement) {
    previewPageRef = el
    updatePreviewScale()
    previewResizeObserver?.disconnect()
    previewResizeObserver = new ResizeObserver(() => updatePreviewScale())
    previewResizeObserver.observe(el)
  }

  function sendToPreview(data: unknown) {
    if (!previewIframeRef?.contentWindow) return
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  if (props.api) {
    props.api.sendToPreview = sendToPreview
    props.api.postMessage = (data: unknown) => {
      if (!previewIframeRef?.contentWindow) return
      previewIframeRef.contentWindow.postMessage(data, "*")
    }
    props.api.refresh = () => {
      if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989"
    }
  }

  const [pickerDialog, setPickerDialog] = createStore<{ domPickerId: string; tagName: string }>({ domPickerId: "", tagName: "" })
  const [pickerText, setPickerText] = createSignal("")

  function unfreezeDomPicker() {
    if (previewIframeRef?.contentWindow)
      previewIframeRef.contentWindow.postMessage({ type: "DOM_PICKER_UNFREEZE" }, "*")
  }

  function submitPicker() {
    const text = pickerText().trim()
    if (!text) return
    dialog.close()
    props.onPickerSubmit?.(text, pickerDialog.domPickerId)
  }

  function showPickerDialog() {
    dialog.show(() => (
      <Dialog title="修改选中区域" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            选中元素: <b>{pickerDialog.tagName}</b> ({pickerDialog.domPickerId})
          </span>
          <div class="flex gap-2">
            <button class="px-3 py-1 rounded-full text-13-medium transition-colors bg-primary text-on-primary">
              AI 修改
            </button>
          </div>
          <textarea
            value={pickerText()}
            onInput={(e) => setPickerText(e.currentTarget.value)}
            placeholder="描述你想要的修改..."
            rows={3}
            class="w-full resize-none rounded-md border border-divider px-3 py-2 text-14-regular text-text-strong outline-none focus:border-primary"
          />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              取消
            </Button>
            <Button variant="primary" size="large" onClick={submitPicker}>
              确认修改
            </Button>
          </div>
        </div>
      </Dialog>
    ), unfreezeDomPicker)
  }

  const handlePickerMessage = (e: MessageEvent) => {
    if (e.data?.type !== "DOM_PICKER_CONTEXT_MENU") return
    setPickerDialog({ domPickerId: e.data.domPickerId ?? "", tagName: e.data.tagName ?? "" })
    setPickerText("")
    showPickerDialog()
  }
  window.addEventListener("message", handlePickerMessage)
  onCleanup(() => window.removeEventListener("message", handlePickerMessage))

  function showHistoryDialog() {
    const versions = props.versions ?? []
    const currentVersionId = props.currentVersionId
    dialog.show(() => (
      <Dialog title="历史版本" fit>
        <div class="flex flex-col gap-1 py-1 min-w-[260px] min-h-[120px] max-h-[400px] overflow-auto">
          <Show
            when={versions.length > 0}
            fallback={
              <div class="flex items-center justify-center h-full text-xs" style={{ color: "var(--octo-text-secondary)" }}>
                暂无历史版本
              </div>
            }
          >
            <For each={[...versions].reverse()}>
              {(v) => (
                <button
                  class="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-[var(--octo-surface-hover)] shrink-0"
                  onClick={() => {
                    props.onSelectVersion?.(v.id)
                    dialog.close()
                  }}
                >
                  <span style={{
                    color: v.id === currentVersionId ? "var(--octo-brand)" : "var(--octo-text-secondary)",
                    "font-size": "10px",
                  }}>
                    {v.id === currentVersionId ? "●" : "○"}
                  </span>
                  <span class="text-xs shrink-0" style={{ color: "var(--octo-text-secondary)", "min-width": "70px" }}>
                    {new Date(v.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span class="text-sm truncate" style={{ color: "var(--octo-text-primary)" }}>
                    {v.summary}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Dialog>
    ))
  }

  return (
    <div ref={bindpreviewPageRef} class="flex flex-col overflow-hidden" style="position:relative">
      <div class="absolute right-[12px] top-[12px] flex gap-[6px]" style={{ "z-index": 10 }}>
        <button class="preview-action-btn" title="历史版本" onClick={showHistoryDialog}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        <button
          class="preview-action-btn"
          title="刷新"
          onClick={() => {
            if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989"
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <button
          class="preview-action-btn"
          title="全屏"
          onClick={() => {
            if (previewPageRef?.requestFullscreen) previewPageRef.requestFullscreen()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>
      </div>
      <div
        style={{
          flex: "1",
          "min-height": "0",
          overflow: "hidden",
          display: "flex",
          "justify-content": "center",
          "align-items": "center",
          padding: "20px",
          position: "relative",
        }}
      >
        <div
          class="preview-iframe-wrapper"
          style={{
            width: `${TARGET_WIDTH}px`,
            height: `${TARGET_HEIGHT}px`,
            transform: `scale(${previewScale()})`,
          }}
        >
          <iframe ref={(el) => { previewIframeRef = el }} src="http://127.0.0.1:8989" />
        </div>
      </div>
    </div>
  )
}
