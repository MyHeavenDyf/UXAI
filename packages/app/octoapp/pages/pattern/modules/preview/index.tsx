import { createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/persist"

// 🛠️ 完美保留 HEAD 引入的全新重构模块与样式表
import { TitleBar } from "./TitleBar"
import { CanvasView } from "./CanvasView"
import "./PreviewStyles.css"

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
  
  // 🛠️ 完美保留 HEAD 的物理画布状态与 Ref 指针
  let canvasRef: { reset: () => void } | undefined
  const [canvasMode, setCanvasMode] = createSignal(true)

  // 🛠️ 保留冲突分支的 UI 弹窗管理变量
  const dialog = useDialog()

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  // 🛠️ 保留 HEAD 的原生干净刷新机制
  function triggerRefresh() {
    if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989"
  }

  // === 核心：统一选项改变的处理逻辑 ===
  function handleTitleBarOptionChange(type: "preview" | "device" | "zoom" | "theme", value: string) {
    console.log(`切换类型: ${type}, 选中值: ${value}`)
    
    // 1. 联动：当缩放下拉选择 "适应屏幕" 时，触发画布复位
    if (type === "zoom" && value === "auto") {
      canvasRef?.reset()
    }
    
    // 2. 联动：当触发最新的主题和其它选项切换时，可在这里向外或向 iframe 发送指令
    if (type === "theme") {
      // 预留给未来 iframe 换肤
      previewIframeRef?.contentWindow?.postMessage({ type: "THEME_CHANGE", theme: value }, "*")
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
  // DOM 区域元素选择 AI 修改弹窗
  // ==========================================================================
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
            <Button variant="primary" size="large" onClick={submitPicker} style={{"background-color":"rgb(10, 89, 247)", color:"white"}}>
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


  // ==========================================================================
  // 视图层完美组合渲染
  // ==========================================================================
  return (
    <div ref={(el) => { previewPageRef = el }} class="preview-container">
      {/* 🛠️ 高级内聚的双层 Top 工具栏 */}
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
        onOptionChange={handleTitleBarOptionChange}
      />

      {/* 🛠️ 无缝平铺的极致丝滑物理交互画布 */}
      <CanvasView 
        ref={(el) => { canvasRef = el }}
        canvasMode={canvasMode()} 
        targetWidth={TARGET_WIDTH} 
        targetHeight={TARGET_HEIGHT}
      >
        <iframe 
          ref={(el) => { previewIframeRef = el }} 
          src="http://127.0.0.1:8989" 
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </CanvasView>
    </div>
  )
}