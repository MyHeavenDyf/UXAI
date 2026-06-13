import { createSignal, onCleanup, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/persist"

import { TitleBar } from "./TitleBar"
import { CanvasView } from "./CanvasView"
import "./PreviewStyles.css"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
  lastData?: unknown
}

export function PreviewPage(props: {
  api?: PreviewPageAPI
  pendingData?: unknown
  onPickerSubmit?: (text: string, domPickerId: string) => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
}) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined

  let canvasRef: { reset: () => void } | undefined
  const [canvasMode, setCanvasMode] = createSignal(true)
  const [editing, setEditing] = createSignal(false)

  const dialog = useDialog()

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  function triggerRefresh() {
    if (props.api) props.api.lastData = undefined
    if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:51856"
  }

  function handleTitleBarOptionChange(type: "preview" | "device" | "zoom" | "theme", value: string) {
    console.log(`切换类型: ${type}, 选中值: ${value}`)

    if (type === "zoom" && value === "auto") {
      canvasRef?.reset()
    }

    if (type === "theme") {
      previewIframeRef?.contentWindow?.postMessage({ type: "TOGGLE_THEME", theme: value }, "*")
    }
  }

  function sendToPreview(data: unknown) {
    if (props.api) props.api.lastData = data
    if (!previewIframeRef?.contentWindow) return
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  if (props.api) {
    props.api.sendToPreview = sendToPreview
    props.api.postMessage = (data: unknown) => {
      if (!previewIframeRef?.contentWindow) return
      previewIframeRef.contentWindow.postMessage(data, "*")
    }
    props.api.refresh = triggerRefresh
  }

  // ==========================================================================
  // DOM 区域元素选择 AI 修改弹窗
  // ==========================================================================
  const [pickerDialog, setPickerDialog] = createStore<{ domPickerId: string; tagName: string }>({ domPickerId: "", tagName: "" })
  const [pickerText, setPickerText] = createSignal("")

  function unfreezeDomPicker() {
    if (previewIframeRef?.contentWindow){
      previewIframeRef.contentWindow.postMessage({ type: "DOM_PICKER_UNFREEZE" }, "*")
    }
  }

  function submitPicker() {
    const text = pickerText().trim()
    if (!text) return
    dialog.close()
    props.onPickerSubmit?.(text, pickerDialog.domPickerId)
  }

  function showPickerDialog() {
    dialog.show(() => (
      <Dialog title={`修改选中区域: ${pickerDialog.tagName} (${pickerDialog.domPickerId})`} fit class="picker-dialog-bottom">
        <div class="flex flex-col gap-4 pl-6 pr-6 pb-3">
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
            <Button variant="primary" size="large" onClick={submitPicker} style={{ "background-color": "rgb(10, 89, 247)", color: "white" }}>
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

  const handleIframeMessage = (e: MessageEvent) => {
    handlePickerMessage(e)
    if (e.data?.type === "A2UI_READY" && props.api?.lastData) {
      sendToPreview(props.api.lastData)
    }
  }
  window.addEventListener("message", handleIframeMessage)
  onCleanup(() => window.removeEventListener("message", handleIframeMessage))

  // 发送待处理数据
  const handleReadyMessage = (e: MessageEvent) => {
    if (e.data?.type !== "A2UI_READY") return
    if (props.pendingData) sendToPreview(props.pendingData)
  }
  window.addEventListener("message", handleReadyMessage)
  onCleanup(() => window.removeEventListener("message", handleReadyMessage))

  createEffect(() => {
    const data = props.pendingData
    if (data && previewIframeRef?.contentWindow) {
      sendToPreview(data)
    }
  })

  return (
    <div ref={(el) => { previewPageRef = el }} class="preview-container">
      <TitleBar
        canvasMode={canvasMode()}
        onToggleCanvasMode={() => setCanvasMode(!canvasMode())}
        onReset={() => canvasRef?.reset()}
        onRefresh={triggerRefresh}
        onFullscreen={() => {
          if (previewPageRef?.requestFullscreen) previewPageRef.requestFullscreen()
        }}
        versions={props.versions}
        currentVersionId={props.currentVersionId}
        onSelectVersion={props.onSelectVersion}
        editing={editing()}
        onToggleEditing={() => {
          const next = !editing()
          setEditing(next)
          previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: next }, "*")
        }}
        onOptionChange={handleTitleBarOptionChange}
      />

      <CanvasView
        ref={(el) => { canvasRef = el }}
        canvasMode={canvasMode()}
        targetWidth={TARGET_WIDTH}
        targetHeight={TARGET_HEIGHT}
      >
        <iframe
          ref={(el) => { previewIframeRef = el }}
          src="http://127.0.0.1:51856"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </CanvasView>
    </div>
  )
}
