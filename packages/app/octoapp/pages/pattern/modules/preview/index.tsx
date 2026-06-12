import { For, Show, createSignal, onCleanup } from "solid-js"
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
  // 冲突分支的核心功能 1：DOM 区域元素选择 AI 修改弹窗
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


  // ==========================================================================
  // 冲突分支的核心功能 2：版本控制历史弹窗
  // ==========================================================================
  // 联动：当用户点击 TitleBar 的历史版本按钮时，优雅呼起这个弹窗
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

  // ==========================================================================
  // 3. 视图层完美组合渲染（彻底移除冲突分支的老旧绝对定位浮动 div 结构）
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
        // 绑定数据下拉及主题切换事件
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