import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/version-history"

import { TitleBar } from "./title-bar"
import { CanvasView } from "./canvas-view"
import { PropertyEditorPopup } from "./property-editor-popup"
import { AnnotationPopup } from "./annotation-popup"
import type { ModifyElementData } from "./property-editor-popup"
import type { A2UIDocument } from "../../utils/a2ui-protocol"
import { type Annotation } from "./annotation-popup"
import { useAnnotations, type RawRect } from "./annotation-module"
import "../../assets/style/preview/index.css"

export type PreviewPageAPI = {
  sendToPreview: (data: unknown) => void
  postMessage: (data: unknown) => void
  refresh: () => void
  setEditingOff: () => void
}



export function PreviewPage(props: {
  api?: PreviewPageAPI
  pendingData?: unknown
  sessionId?: string
  dir?: string
  onPickerSubmit?: (text: string, id: string) => void
  onModifyElement?: (data: ModifyElementData) => void
  onDownload?: () => void
  onShare?: () => void
  onLivePreview?: () => void
  onPixsoPreview?: () => void
  onCodeToHtml?: () => void
  onCanvasEditing?: () => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
  onReorder?: (elementId: string, targetSiblingId: string, position: "before" | "after") => void
}) {
  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPageRef: HTMLDivElement | undefined

  let canvasRef: { reset: () => void; setScale: (scale: number) => void; viewportElement: () => HTMLDivElement | undefined } | undefined

  const [canvasMode, setCanvasMode] = createSignal(true)
  const [editing, setEditing] = createSignal(false)
  const [annotating, setAnnotating] = createSignal(false)
  const [targetWidth, setTargetWidth] = createSignal(1920)
  const [targetHeight, setTargetHeight] = createSignal(1080)

  function unfreezeDomPicker() {
    previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_UNFREEZE" }, "*")
  }

  const anno = useAnnotations({
    dir: () => props.dir,
    sessionId: () => props.sessionId,
    pendingData: () => props.pendingData,
    editing,
    annotating,
    previewIframeRef: () => previewIframeRef,
    previewPageRef: () => previewPageRef,
    canvasRef: { viewportElement: () => canvasRef?.viewportElement() },
    targetWidth,
    unfreezeDomPicker,
  })

  const DEVICE_DIMENSIONS: Record<string, [number, number]> = {
    desktop: [1920, 1080],
    tablet: [768, 1024],
    mobile: [375, 667],
  }

  createEffect(() => {
    if (!editing()) {
      setPropertyEditor('show', false)
      setPickerVisible(false)
    }
  })

  
  function triggerRefresh() {
    anno.setIframeReady(false)
    anno.resetAnnotations()
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

    if (type === "preview" && value === "capture") {
      props.onCodeToHtml?.()
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
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
    if (editing()) sendDragMode(true, data)
  }

  function buildSiblingMap(data: unknown = props.pendingData): Record<string, string[]> | undefined {
    const doc = data as A2UIDocument | null
    if (!doc?.elements) return undefined
    const map: Record<string, string[]> = {}
    for (const el of doc.elements) {
      if (!Array.isArray(el.children)) continue
      const kids = el.children.filter((kid): kid is string => typeof kid === "string")
      if (kids.length < 2) continue
      for (const kid of kids) {
        map[kid] = kids
      }
    }
    return Object.keys(map).length > 0 ? map : undefined
  }

  function sendDragMode(enabled: boolean, data: unknown = props.pendingData) {
    previewIframeRef?.contentWindow?.postMessage(
      { type: "DRAG_MODE", enabled, siblingMap: enabled ? buildSiblingMap(data) : undefined },
      "*",
    )
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
      setPickerVisible(false)
      setCtxMenu('show', false)
      unfreezeDomPicker()
    }
  }

  // ==========================================================================
  // DOM 区域元素选择 — 右键菜单 + 修改弹窗
  // ==========================================================================
  const [pickerDialog, setPickerDialog] = createStore<{ id: string; tagName: string }>({ id: "", tagName: "" })
  const [pickerText, setPickerText] = createSignal("")
  const [pickerVisible, setPickerVisible] = createSignal(false)
  const [pickerDrag, setPickerDrag] = createStore({ x: 0, y: 0 })

  function startPickerDrag(e: MouseEvent) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const ox = pickerDrag.x, oy = pickerDrag.y
    const onMove = (me: MouseEvent) => setPickerDrag({ x: ox + (me.clientX - sx), y: oy + (me.clientY - sy) })
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const [ctxMenu, setCtxMenu] = createStore({
    show: false, x: 0, y: 0,
    id: '', tagName: '', domPickerComponent: '', domPickerClass: '', elementProps: '',
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

  function maybeUnfreeze() {
    if (!propertyEditor.show && !pickerVisible() && !ctxMenu.show) unfreezeDomPicker()
  }

  function hideCtxMenu() { setCtxMenu('show', false) }

  function closeCtxMenu() {
    if (!ctxMenu.show) return
    setCtxMenu('show', false)
    maybeUnfreeze()
  }

  function closePicker() {
    setPickerVisible(false)
    maybeUnfreeze()
  }

  function submitPicker() {
    const text = pickerText().trim()
    if (!text) return
    setPickerVisible(false)
    setPropertyEditor('show', false)
    maybeUnfreeze()
    props.onPickerSubmit?.(text, pickerDialog.id)
  }

  function handleCopyName() {
    const text = ctxMenu.id
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

  function handleSelectParent() {
    previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_SELECT_PARENT" }, "*")
  }

  function openBothPanels(data: {
    id: string
    domPickerComponent?: string
    domPickerClass?: string
    elementProps?: string
    tagName?: string
    rawRect?: RawRect | null
  }) {
    openQuickModify(data)
    setPickerDialog({ id: data.id, tagName: data.tagName ?? '' })
    setPickerText('')
    setPickerDrag({ x: 0, y: 0 })
    setPickerVisible(true)
    if (ctxMenu.show) {
      setCtxMenu({
        id: data.id,
        tagName: data.tagName ?? '',
        domPickerComponent: data.domPickerComponent ?? '',
        domPickerClass: data.domPickerClass ?? '',
        elementProps: data.elementProps ?? '',
        rawRect: data.rawRect ?? null,
      })
    }
  }

  function openQuickModify(data: {
    id: string
    domPickerComponent?: string
    domPickerClass?: string
    elementProps?: string
    tagName?: string
    rawRect?: RawRect | null
  }) {
    const paneRect = previewPageRef?.getBoundingClientRect()
    const wrapper = previewIframeRef?.closest('.preview-iframe-wrapper') as HTMLElement | null
    const wrapperRect = wrapper?.getBoundingClientRect()
    const scale = (wrapperRect?.width ?? targetWidth()) / targetWidth()
    const rawRect = data.rawRect ?? { top: 0, left: 0, width: 0, height: 0 }

    const cx = 46
    const cy = 57

    setPropertyEditor('show', false)
    queueMicrotask(() => {
      const compType = data.domPickerComponent || data.tagName || ''
      console.log("[preview] open property editor:", { elementId: data.id, componentType: compType, class: data.domPickerClass, props: data.elementProps })
      setPropertyEditor({
        show: true,
        elementId: data.id,
        componentType: compType,
        currentClass: data.domPickerClass ?? '',
        elementProps: data.elementProps ?? '',
        clickPoint: { x: cx, y: cy },
        elementRect: {
          top: (wrapperRect?.top ?? 0) - (paneRect?.top ?? 0) + rawRect.top * scale,
          left: (wrapperRect?.left ?? 0) - (paneRect?.left ?? 0) + rawRect.left * scale,
          width: rawRect.width * scale, height: rawRect.height * scale,
        },
      })
    })
  }

  function handleQuickModify() {
    openQuickModify(ctxMenu)
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
      maybeUnfreeze()
    }
    props.onModifyElement?.(data)
  }

  function handlePropertyCancel() {
    setPropertyEditor('show', false)
    maybeUnfreeze()
  }

  const handlePickerMessage = (e: MessageEvent) => {
    if (e.data?.type === "DOM_PICKER_CLOSE_PANELS") {
      if (anno.annotationPopup.show) {
        anno.handleAnnotationClose()
        if (!editing()) return
      }
      if (ctxMenu.show) {
        closeCtxMenu()
        return
      }
      setPropertyEditor('show', false)
      setPickerVisible(false)
      unfreezeDomPicker()
      return
    }

    if (e.data?.type === "DOM_PICKER_CLOSE_MENU") {
      if (ctxMenu.show) closeCtxMenu()
      return
    }

    if (e.data?.type === "DOM_PICKER_COPY") {
      const { id, tagName } = e.data
      setPickerDialog({ id: id ?? '', tagName: tagName ?? '' })
      setPickerText('')
      setPickerVisible(true)
      return
    }

    if (e.data?.type === "DOM_PICKER_QUICK_FIX") {
      const { id, domPickerComponent, domPickerClass, elementProps, tagName, rect } = e.data
      if (anno.annotationPopup.show && !annotating()) {
        anno.handleAnnotationClose()
        if (!editing()) return
      }
      if (annotating()) {
        if (anno.annotationPopup.show) {
          anno.handleAnnotationClose()
          return
        }
        anno.openAnnotationFromRect(id ?? '', (rect ?? { top: 0, left: 0, width: 0, height: 0 }) as RawRect)
        return
      }
      openBothPanels({
        id: id ?? '',
        domPickerComponent: domPickerComponent ?? '',
        domPickerClass: domPickerClass ?? '',
        elementProps: elementProps ?? '',
        tagName: tagName ?? '',
        rawRect: rect ?? null,
      })
      return
    }

    if (e.data?.type !== "DOM_PICKER_CONTEXT_MENU") return
    if (annotating()) return
    if (ctxMenu.show) { closeCtxMenu(); return }
    const { id, domPickerComponent, domPickerClass, elementProps, tagName, rect, clickX, clickY } = e.data
    console.log("[preview] DOM_PICKER_CONTEXT_MENU:", { id, domPickerComponent, domPickerClass, elementProps, tagName })
    const pos = iframeToPage(clickX, clickY)
    setCtxMenu({
      show: true,
      x: Math.min(pos.x, window.innerWidth - 180),
      y: Math.min(pos.y, window.innerHeight - 150),
      id: id ?? '', tagName: tagName ?? '',
      domPickerComponent: domPickerComponent ?? '', domPickerClass: domPickerClass ?? '', elementProps: elementProps ?? '',
      rawRect: rect ?? null, rawClickX: clickX ?? 0, rawClickY: clickY ?? 0,
    })
  }

  const handleIframeMessage = (e: MessageEvent) => {
    handlePickerMessage(e)
    if (e.data?.type === "A2UI_READY") {
      anno.setIframeReady(true)
      if (props.pendingData) {
        sendToPreview(props.pendingData)
      }
      if (editing()) {
        previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: true }, "*")
        sendDragMode(true, props.pendingData)
      }
    }
    if (e.data?.type === "DRAG_REORDER" && props.onReorder) {
      props.onReorder(e.data.elementId, e.data.targetSiblingId, e.data.position)
    }
  }

  function onClickOutside(e: MouseEvent) {
    if (anno.annotationPopup.show && !(e.target as HTMLElement).closest('.annotation-popup') && !(e.target as HTMLElement).closest('.annotation-badge') && !(e.target as HTMLElement).closest('.annotation-highlight')) {
      anno.handleAnnotationClose()
    }
    if (ctxMenu.show && !(e.target as HTMLElement).closest('.dom-picker-ctx-menu')) {
      closeCtxMenu()
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (anno.annotationPopup.show) { anno.handleAnnotationClose(); return }
      if (ctxMenu.show) { closeCtxMenu(); return }
      if (propertyEditor.show) { handlePropertyCancel(); return }
      if (pickerVisible()) { closePicker(); return }
    }
  }

  function onParentPointerUp(e: PointerEvent) {
    if (!editing() || e.target === previewIframeRef) return
    previewIframeRef?.contentWindow?.postMessage({ type: "DRAG_CANCEL" }, "*")
  }

  window.addEventListener("message", handleIframeMessage)
  window.addEventListener("click", onClickOutside)
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("pointerup", onParentPointerUp)
  onCleanup(() => {
    window.removeEventListener("message", handleIframeMessage)
    window.removeEventListener("click", onClickOutside)
    window.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("pointerup", onParentPointerUp)
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
            setAnnotating(false)
            sendDragMode(false)
            previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
            unfreezeDomPicker()
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
          if (next) {
            setAnnotating(false)
            anno.closeAnnotationPopup()
            setCanvasMode(false)
            sendDragMode(true)
            unfreezeDomPicker()
          } else {
            sendDragMode(false)
            unfreezeDomPicker()
            setCtxMenu('show', false)
          }
        }}
        onOptionChange={handleTitleBarOptionChange}
        annotating={annotating()}
        onToggleAnnotating={() => {
          const next = !annotating()
          setAnnotating(next)
          if (next) {
            setEditing(false)
            setCanvasMode(false)
            sendDragMode(false)
            setPropertyEditor('show', false)
            setPickerVisible(false)
            setCtxMenu('show', false)
            previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: true }, "*")
            unfreezeDomPicker()
          } else {
            previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
            unfreezeDomPicker()
            anno.closeAnnotationPopup()
          }
        }}
        // 画布编辑模式：开启后允许用户在画布上直接拖拽/缩放元素，关闭其他编辑模式
        onCanvasEditing={props.onCanvasEditing}
      />

      <CanvasView
        ref={(el) => { canvasRef = el }}
        canvasMode={canvasMode()}
        targetWidth={targetWidth()}
        targetHeight={targetHeight()}
        overlay={
          <>
            <Show when={anno.visibleAnnotationData().length > 0}>
              <For each={anno.visibleAnnotationData()}>
                {(item) => (
                  <div
                    class="annotation-badge"
                    style={{
                      top: item.pos.top - 28 + "px",
                      left: item.pos.left + item.pos.width - 14 + "px",
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      anno.openAnnotationFor(item.selector)
                    }}
                    title={item.selector}
                  >
                    <svg viewBox="0 0 24 24" width="28" height="28" class="annotation-badge-icon">
                      <g transform="rotate(45 12 12)">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="#ffffff" stroke="rgba(0,0,0,0.1)" stroke-width="1.5" stroke-linejoin="round" />
                      </g>
                    </svg>
                    <img src="/AvatarUser.svg" class="annotation-badge-avatar" />
                  </div>
                )}
              </For>
            </Show>
          </>
        }
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
        </div>
      </Show>

      <PropertyEditorPopup
        show={propertyEditor.show}
        elementId={propertyEditor.elementId}
        componentType={propertyEditor.componentType}
        currentClass={propertyEditor.currentClass}
        elementProps={propertyEditor.elementProps}
        sessionId={props.sessionId}
        elementRect={propertyEditor.elementRect}
        clickPoint={propertyEditor.clickPoint}
        containerSize={{ width: previewPageRef?.clientWidth ?? 0, height: previewPageRef?.clientHeight ?? 0 }}
        onConfirm={handlePropertyConfirm}
        onCancel={handlePropertyCancel}
      />

      <Show when={anno.annotationPopup.show && anno.annotationPopup.target}>
        <AnnotationPopup
          target={anno.annotationPopup.target!}
          author="用户"
          annotations={anno.annotations
            .filter((a) => a.selector === anno.annotationPopup.target!.elementId)
            .map((a): Annotation => ({
              id: a.id,
              elementId: a.selector,
              author: "用户",
              authorInitial: "用",
              text: a.note,
              attachments: a.attachments.map((att) => att.fileName),
              createdAt: a.time,
            }))}
          onSend={anno.handleAnnotationSend}
          onClose={anno.handleAnnotationClose}
          onDelete={anno.handleDeleteAnnotation}
          onEdit={anno.handleEditAnnotation}
        />
      </Show>

      <Show when={pickerVisible()}>
        <div class="picker-overlay" onClick={closePicker}>
          <div
            class="picker-dialog"
            style={{ transform: `translate(${pickerDrag.x}px, ${pickerDrag.y}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="picker-header" onMouseDown={startPickerDrag}>
              修改选中区域: {pickerDialog.tagName} ({pickerDialog.id})
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
