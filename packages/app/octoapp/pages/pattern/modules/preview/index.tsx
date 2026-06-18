import { createSignal, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/persist"

import { TitleBar } from "./TitleBar"
import { CanvasView } from "./CanvasView"
import "../../assets/style/preview/index.css"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
}

export function PreviewPage(props: {
  api?: PreviewPageAPI
  pendingData?: unknown
  onPickerSubmit?: (text: string, domPickerId: string) => void
  onDownload?: () => void
  onLivePreview?: () => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
}) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined

  let canvasRef: { reset: () => void } | undefined
  const [canvasMode, setCanvasMode] = createSignal(true)
  const [editing, setEditing] = createSignal(false)

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  function triggerRefresh() {
    if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:51856"
  }

  function handleTitleBarOptionChange(type: "preview" | "device" | "zoom" | "theme", value: string) {
    console.log(`切换类型: ${type}, 选中值: ${value}`)

    if (type === "preview" && value === "live") {
      props.onLivePreview?.()
      return
    }

    if (type === "zoom" && value === "auto") {
      canvasRef?.reset()
    }

    if (type === "theme") {
      previewIframeRef?.contentWindow?.postMessage({ type: "TOGGLE_THEME", theme: value }, "*")
    }
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
    props.api.refresh = triggerRefresh
  }

  // ==========================================================================
  // DOM 区域元素选择 AI 修改弹窗（preview 容器内绝对定位）
  // ==========================================================================
  const [pickerDialog, setPickerDialog] = createStore<{ domPickerId: string; tagName: string }>({ domPickerId: "", tagName: "" })
  const [pickerText, setPickerText] = createSignal("")
  const [pickerVisible, setPickerVisible] = createSignal(false)

  function unfreezeDomPicker() {
    if (previewIframeRef?.contentWindow){
      previewIframeRef.contentWindow.postMessage({ type: "DOM_PICKER_UNFREEZE" }, "*")
    }
  }

  function closePicker() {
    setPickerVisible(false)
    unfreezeDomPicker()
  }

  function submitPicker() {
    const text = pickerText().trim()
    if (!text) return
    setPickerVisible(false)
    unfreezeDomPicker()
    props.onPickerSubmit?.(text, pickerDialog.domPickerId)
  }

  const handlePickerMessage = (e: MessageEvent) => {
    if (e.data?.type !== "DOM_PICKER_CONTEXT_MENU") return
    setPickerDialog({ domPickerId: e.data.domPickerId ?? "", tagName: e.data.tagName ?? "" })
    setPickerText("")
    setPickerVisible(true)
  }

  const handleIframeMessage = (e: MessageEvent) => {
    handlePickerMessage(e)
    if (e.data?.type === "A2UI_READY" && props.pendingData) {
      sendToPreview(props.pendingData)
    }
  }
  window.addEventListener("message", handleIframeMessage)
  onCleanup(() => window.removeEventListener("message", handleIframeMessage))

  return (
    <div ref={(el) => { previewPageRef = el }} class="preview-container">
      <TitleBar
        canvasMode={canvasMode()}
        onToggleCanvasMode={() => {
          const next = !canvasMode()
          setCanvasMode(next)
          if (next) {
            setEditing(false)
            previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
          }
        }}
        onReset={() => canvasRef?.reset()}
        onRefresh={triggerRefresh}
        onFullscreen={() => {
          if (previewPageRef?.requestFullscreen) previewPageRef.requestFullscreen()
        }}
        onDownload={props.onDownload}
        versions={props.versions}
        currentVersionId={props.currentVersionId}
        onSelectVersion={props.onSelectVersion}
        editing={editing()}
        onToggleEditing={() => {
          const next = !editing()
          setEditing(next)
          previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: next }, "*")
          if (next) setCanvasMode(false)
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
          onLoad={() => {
            if (props.pendingData) sendToPreview(props.pendingData)
          }}
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </CanvasView>

      <Show when={pickerVisible()}>
        <div class="picker-overlay" onClick={closePicker}>
          <div class="picker-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="picker-header">
              修改选中区域: {pickerDialog.tagName} ({pickerDialog.domPickerId})
            </div>
            <div class="picker-body">
              <textarea
                value={pickerText()}
                onInput={(e) => setPickerText(e.currentTarget.value)}
                placeholder="描述你想要的修改..."
                rows={2}
                class="w-full resize-none rounded-md border border-divider px-3 py-2 text-14-regular text-text-strong outline-none focus:border-primary"
              />
              <div class="flex justify-end gap-2" style={{"margin-top": "12px"}}>
                <Button variant="ghost" size="large" onClick={closePicker}>
                  取消
                </Button>
                <Button variant="primary" size="large" onClick={submitPicker} style={{ "background-color": "rgb(10, 89, 247)", color: "white" }}>
                  确认修改
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
