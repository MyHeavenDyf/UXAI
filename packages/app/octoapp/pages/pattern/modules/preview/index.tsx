import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/version-history"

import { TitleBar } from "./TitleBar"
import { CanvasView } from "./CanvasView"
import { PropertyEditorPopup } from "./PropertyEditorPopup"
import type { ModifyElementData } from "./PropertyEditorPopup"
import "../../assets/style/preview/index.css"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
  setEditingOff: () => void
}

interface RawRect {
  top: number
  left: number
  width: number
  height: number
}

export function PreviewPage(props: {
  api?: PreviewPageAPI
  pendingData?: unknown
  onPickerSubmit?: (text: string, domPickerId: string) => void
  onModifyElement?: (data: ModifyElementData) => void
  onDownload?: () => void
  onShare?: () => void
  onLivePreview?: () => void
  onPixsoPreview?: () => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
}) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined

  let canvasRef: { reset: () => void; setScale: (scale: number) => void } | undefined
  const [canvasMode, setCanvasMode] = createSignal(true)
  const [editing, setEditing] = createSignal(false)

  const DEVICE_DIMENSIONS: Record<string, [number, number]> = {
    desktop: [1920, 1080],
    tablet: [768, 1024],
    mobile: [375, 667],
  }
  const [targetWidth, setTargetWidth] = createSignal(1920)
  const [targetHeight, setTargetHeight] = createSignal(1080)

  createEffect(() => {
    if (!editing()) setPropertyEditor('show', false)
  })

  
  function triggerRefresh() {
    if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:51856"
  }

  function handleTitleBarOptionChange(type: "preview" | "device" | "zoom" | "theme", value: string) {
    console.log(`切换类型: ${type}, 选中值: ${value}`)

    if (type === "device") {
      const dims = DEVICE_DIMENSIONS[value]
      if (dims) {
        setTargetWidth(dims[0])
        setTargetHeight(dims[1])
        queueMicrotask(() => canvasRef?.reset())
      }
      return
    }

    if (type === "preview" && value === "live") {
      props.onLivePreview?.()
      return
    }

    if (type === "preview" && value === "pixso") {
      props.onPixsoPreview?.()
      return
    }

    if (type === "zoom") {
      canvasRef?.setScale(Number(value) / 100)
    }

    if (type === "theme") {
      previewIframeRef?.contentWindow?.postMessage({ type: "TOGGLE_THEME", theme: value }, "*")
    }
  }

  function sendToPreview(data: unknown) {
    if (!previewIframeRef?.contentWindow) {
      console.log("[preview] sendToPreview skipped: no iframe")
      return
    }
    console.log("[preview] sendToPreview posting A2UI_UPDATE")
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  if (props.api) {
    props.api.sendToPreview = sendToPreview
    props.api.postMessage = (data: unknown) => {
      if (!previewIframeRef?.contentWindow) return
      previewIframeRef.contentWindow.postMessage(data, "*")
    }
    props.api.refresh = triggerRefresh
    props.api.setEditingOff = () => {
      setEditing(false)
      previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
      setPropertyEditor('show', false)
      unfreezeDomPicker()
    }
  }

  // ==========================================================================
  // DOM 区域元素选择 — 右键菜单 + 修改弹窗
  // ==========================================================================
  const [pickerDialog, setPickerDialog] = createStore<{ domPickerId: string; tagName: string }>({ domPickerId: "", tagName: "" })
  const [pickerText, setPickerText] = createSignal("")
  const [pickerVisible, setPickerVisible] = createSignal(false)

  const [ctxMenu, setCtxMenu] = createStore({
    show: false, x: 0, y: 0,
    domPickerId: '', tagName: '', domPickerComponent: '', domPickerClass: '', elementProps: '',
    rawRect: null as RawRect | null,
    rawClickX: 0, rawClickY: 0,
  })

  function iframeToPage(iframeX: number, iframeY: number) {
    const wrapper = previewIframeRef?.closest('.preview-iframe-wrapper') as HTMLElement | null
    if (!wrapper) return { x: iframeX, y: iframeY }
    const rect = wrapper.getBoundingClientRect()
    const scale = rect.width / targetWidth()
    return { x: rect.left + iframeX * scale, y: rect.top + iframeY * scale }
  }

  function unfreezeDomPicker() {
    previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_UNFREEZE" }, "*")
  }

  function hideCtxMenu() { setCtxMenu('show', false) }

  function closeCtxMenu() {
    if (!ctxMenu.show) return
    setCtxMenu('show', false)
    unfreezeDomPicker()
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

  function handleCopyName() {
    const text = ctxMenu.domPickerId
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    closeCtxMenu()
  }

  function handleSelectArea() {
    setPickerDialog({ domPickerId: ctxMenu.domPickerId, tagName: ctxMenu.tagName })
    setPickerText('')
    setPickerVisible(true)
    hideCtxMenu()
  }

  function handleSelectParent() {
    previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_SELECT_PARENT" }, "*")
    closeCtxMenu()
  }

  function handleQuickModify() {
    const paneRect = previewPageRef?.getBoundingClientRect()
    const wrapper = previewIframeRef?.closest('.preview-iframe-wrapper') as HTMLElement | null
    const wrapperRect = wrapper?.getBoundingClientRect()
    const scale = (wrapperRect?.width ?? targetWidth()) / targetWidth()
    const rawRect = ctxMenu.rawRect ?? { top: 0, left: 0, width: 0, height: 0 }

    const cx = 46
    const cy = 57

    setPropertyEditor('show', false)
    queueMicrotask(() => {
      const compType = ctxMenu.domPickerComponent || ctxMenu.tagName
      console.log("[preview] open property editor:", { elementId: ctxMenu.domPickerId, componentType: compType, class: ctxMenu.domPickerClass, props: ctxMenu.elementProps })
      setPropertyEditor({
        show: true,
        elementId: ctxMenu.domPickerId,
        componentType: compType,
        currentClass: ctxMenu.domPickerClass ?? '',
        elementProps: ctxMenu.elementProps ?? '',
        clickPoint: { x: cx, y: cy },
        elementRect: {
          top: (wrapperRect?.top ?? 0) - (paneRect?.top ?? 0) + rawRect.top * scale,
          left: (wrapperRect?.left ?? 0) - (paneRect?.left ?? 0) + rawRect.left * scale,
          width: rawRect.width * scale, height: rawRect.height * scale,
        },
      })
    })
    hideCtxMenu()
  }

  const [propertyEditor, setPropertyEditor] = createStore({
    show: false, elementId: '', componentType: '', currentClass: '', elementProps: '',
    elementRect: { top: 0, left: 0, width: 0, height: 0 },
    clickPoint: { x: 0, y: 0 },
  })

  function handlePropertyConfirm(data: ModifyElementData) {
    if (!data.keepOpen) {
      setPropertyEditor('show', false)
      unfreezeDomPicker()
    }
    props.onModifyElement?.(data)
  }

  function handlePropertyCancel() {
    setPropertyEditor('show', false)
    unfreezeDomPicker()
  }

  const handlePickerMessage = (e: MessageEvent) => {
    if (e.data?.type === "DOM_PICKER_CLOSE_MENU") {
      if (ctxMenu.show) closeCtxMenu()
      return
    }

    if (e.data?.type === "DOM_PICKER_COPY") {
      const { domPickerId, tagName } = e.data
      setPickerDialog({ domPickerId: domPickerId ?? '', tagName: tagName ?? '' })
      setPickerText('')
      setPickerVisible(true)
      return
    }

    if (e.data?.type !== "DOM_PICKER_CONTEXT_MENU") return
    if (ctxMenu.show) { closeCtxMenu(); return }
    const { domPickerId, domPickerComponent, domPickerClass, elementProps, tagName, rect, clickX, clickY } = e.data
    console.log("[preview] DOM_PICKER_CONTEXT_MENU:", { domPickerId, domPickerComponent, domPickerClass, elementProps, tagName })
    const pos = iframeToPage(clickX, clickY)
    setCtxMenu({
      show: true,
      x: Math.min(pos.x, window.innerWidth - 180),
      y: Math.min(pos.y, window.innerHeight - 150),
      domPickerId: domPickerId ?? '', tagName: tagName ?? '',
      domPickerComponent: domPickerComponent ?? '', domPickerClass: domPickerClass ?? '', elementProps: elementProps ?? '',
      rawRect: rect ?? null, rawClickX: clickX ?? 0, rawClickY: clickY ?? 0,
    })
  }

  const handleIframeMessage = (e: MessageEvent) => {
    handlePickerMessage(e)
    if (e.data?.type === "A2UI_READY") {
      if (props.pendingData) {
        console.log("[preview] A2UI_READY, re-sending pendingData")
        sendToPreview(props.pendingData)
      }
      if (editing()) {
        previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: true }, "*")
      }
    }
  }

  function onClickOutside(e: MouseEvent) {
    if (ctxMenu.show && !(e.target as HTMLElement).closest('.dom-picker-ctx-menu')) {
      closeCtxMenu()
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (ctxMenu.show) { closeCtxMenu(); return }
      if (propertyEditor.show) { handlePropertyCancel(); return }
      if (pickerVisible()) { closePicker(); return }
    }
  }

  window.addEventListener("message", handleIframeMessage)
  window.addEventListener("click", onClickOutside)
  window.addEventListener("keydown", onKeyDown)
  onCleanup(() => {
    window.removeEventListener("message", handleIframeMessage)
    window.removeEventListener("click", onClickOutside)
    window.removeEventListener("keydown", onKeyDown)
  })

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
        onShare={props.onShare}
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
        targetWidth={targetWidth()}
        targetHeight={targetHeight()}
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

      <Show when={ctxMenu.show}>
        <div class="dom-picker-ctx-menu" style={{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }}
             onClick={(e) => e.stopPropagation()}>
          <div class="ctx-menu-item" onClick={handleSelectParent}>选择父容器</div>
          <div class="ctx-menu-item" onClick={handleCopyName}>复制名称</div>
          <div class="ctx-menu-item" onClick={handleSelectArea}>AI修改</div>
          <div class="ctx-menu-item" onClick={handleQuickModify}>快速修改</div>
        </div>
      </Show>

      <PropertyEditorPopup
        show={propertyEditor.show}
        elementId={propertyEditor.elementId}
        componentType={propertyEditor.componentType}
        currentClass={propertyEditor.currentClass}
        elementProps={propertyEditor.elementProps}
        elementRect={propertyEditor.elementRect}
        clickPoint={propertyEditor.clickPoint}
        containerSize={{ width: previewPageRef?.clientWidth ?? 0, height: previewPageRef?.clientHeight ?? 0 }}
        onConfirm={handlePropertyConfirm}
        onCancel={handlePropertyCancel}
      />

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
