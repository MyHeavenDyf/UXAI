import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import type { VersionEntry } from "../../utils/version-history"

import { TitleBar } from "./title-bar"
import { CanvasView } from "./canvas-view"
import { PropertyEditorPopup } from "./property-editor-popup"
import { AnnotationPopup, type AnnotationTarget } from "./annotation-popup"
import type { ModifyElementData } from "./property-editor-popup"
import type { A2UIDocument } from "../../utils/a2ui-protocol"
import { loadAnnotations, saveAnnotations, saveAttachment, type AnnotationRecord } from "../../utils/annotation-persist"
import { getDesktopApi } from "../../utils/desktop-api"
import { type Annotation } from "./annotation-popup"
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
  sessionId?: string
  dir?: string
  onPickerSubmit?: (text: string, domPickerId: string) => void
  onModifyElement?: (data: ModifyElementData) => void
  onDownload?: () => void
  onShare?: () => void
  onLivePreview?: () => void
  onPixsoPreview?: () => void
  onCodeToHtml?: () => void
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
  const [annotations, setAnnotations] = createStore<Array<AnnotationRecord & {
    pos: { top: number; left: number; width: number; height: number } | null
  }>>([])

  const [annotationPopup, setAnnotationPopup] = createStore({
    show: false,
    target: null as AnnotationTarget | null,
    rawRect: null as RawRect | null,
  })

  const visibleAnnotationData = createMemo(() => {
    const popupSelector = annotationPopup.show ? annotationPopup.target?.elementId : null
    return annotations.reduce<Array<{ selector: string; pos: { top: number; left: number; width: number; height: number }; originalIndex: number }>>((acc, a, i) => {
      if (a.pos && a.selector !== popupSelector) acc.push({ selector: a.selector, pos: a.pos, originalIndex: i })
      return acc
    }, [])
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  let loadSeq = 0

  createEffect(() => {
    if (!props.dir || !props.sessionId) return
    const vid = props.currentVersionId || props.versions?.[0]?.id || "current"
    if (!vid) return
    const seq = ++loadSeq
    console.log("[preview] loadAnnotations", { vid, currentVersionId: props.currentVersionId, latestVersion: props.versions?.[0]?.id })
    loadAnnotations(props.dir, props.sessionId, vid).then((data) => {
      if (seq !== loadSeq) return
      console.log("[preview] loadAnnotations result", vid, data.length)
      setAnnotations(data.map((a) => ({ ...a, pos: null })))
    })
  })

  function persistAnnotations() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!props.dir || !props.sessionId) return
      const vid = props.currentVersionId || props.versions?.[0]?.id || "current"
      const records: AnnotationRecord[] = annotations.map(({ pos: _, ...rest }) => rest)
      saveAnnotations(props.dir, props.sessionId, vid, records)
    }, 500)
  }

  let rafId: number | null = null
  let debugOnce = false

  createEffect(() => {
    const shouldRun = annotations.length > 0 || (annotationPopup.show && annotationPopup.rawRect)
    if (shouldRun && rafId === null) {
      const loop = () => {
        rafId = requestAnimationFrame(loop)
        const canvasEl = canvasRef?.viewportElement()
        const canvasRect = canvasEl?.getBoundingClientRect()
        const paneRect = previewPageRef?.getBoundingClientRect()
        const wrapper = previewIframeRef?.closest('.preview-iframe-wrapper') as HTMLElement | null
        const wrapperRect = wrapper?.getBoundingClientRect()
        const scale = (wrapperRect?.width ?? targetWidth()) / targetWidth()
        if (!debugOnce && annotations.length > 0) {
          debugOnce = true
          const r0 = annotations[0].rawRect
          console.log("[preview] rAF first frame", {
            hasCanvasEl: !!canvasEl,
            canvasRect,
            hasWrapper: !!wrapper,
            wrapperRect,
            scale,
            rawRect0: r0,
            firstPos: r0 ? {
              top: (wrapperRect?.top ?? 0) - (canvasRect?.top ?? 0) + r0.top * scale,
              left: (wrapperRect?.left ?? 0) - (canvasRect?.left ?? 0) + r0.left * scale,
              width: r0.width * scale,
              height: r0.height * scale,
            } : null,
          })
        }
        if (annotationPopup.show && annotationPopup.rawRect) {
          const r = annotationPopup.rawRect!
          setAnnotationPopup('target', 'elementRect', {
            top: (wrapperRect?.top ?? 0) - (paneRect?.top ?? 0) + r.top * scale,
            left: (wrapperRect?.left ?? 0) - (paneRect?.left ?? 0) + r.left * scale,
            width: r.width * scale,
            height: r.height * scale,
          })
        }
        for (let i = 0; i < annotations.length; i++) {
          const r = annotations[i].rawRect
          if (!r) continue
          setAnnotations(i, 'pos', {
            top: (wrapperRect?.top ?? 0) - (canvasRect?.top ?? 0) + r.top * scale,
            left: (wrapperRect?.left ?? 0) - (canvasRect?.left ?? 0) + r.left * scale,
            width: r.width * scale,
            height: r.height * scale,
          })
        }
      }
      rafId = requestAnimationFrame(loop)
    }
    if (!shouldRun && rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  })

  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
  })

  async function handleAnnotationSend(text: string, files: File[]) {
    const id = crypto.randomUUID()
    const attachments: Array<{ fileName: string; id: string }> = []
    for (const file of files) {
      const buf = await file.arrayBuffer()
      const result = await saveAttachment(props.dir!, props.sessionId!, id, file.name, buf)
      attachments.push(result)
    }
    const record = {
      id, note: text, selector: annotationPopup.target!.elementId,
      attachments, time: Date.now(),
      rawRect: annotationPopup.rawRect!,
      pos: null,
    }
    setAnnotations([...annotations, record])
    persistAnnotations()
  }

  function handleAnnotationClose() {
    setAnnotationPopup({ show: false, target: null, rawRect: null })
    if (annotating()) {
      previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: true }, "*")
    }
  }

  function openAnnotationFor(selector: string) {
    const anno = annotations.find((a) => a.selector === selector)
    if (!anno?.pos) return
    const paneRect = previewPageRef?.getBoundingClientRect()
    const canvasRect = canvasRef?.viewportElement()?.getBoundingClientRect()
    const offsetY = (canvasRect?.top ?? 0) - (paneRect?.top ?? 0)
    const offsetX = (canvasRect?.left ?? 0) - (paneRect?.left ?? 0)
    setAnnotationPopup({
      show: true,
      rawRect: anno.rawRect,
      target: { elementId: selector, elementRect: {
        top: anno.pos.top + offsetY,
        left: anno.pos.left + offsetX,
        width: anno.pos.width,
        height: anno.pos.height,
      }},
    })
    previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
    unfreezeDomPicker()
  }

  const DEVICE_DIMENSIONS: Record<string, [number, number]> = {
    desktop: [1920, 1080],
    tablet: [768, 1024],
    mobile: [375, 667],
  }
  const [targetWidth, setTargetWidth] = createSignal(1920)
  const [targetHeight, setTargetHeight] = createSignal(1080)

  createEffect(() => {
    if (!editing()) {
      setPropertyEditor('show', false)
      setPickerVisible(false)
    }
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
    console.log("[preview] sendToPreview posting A2UI_UPDATE")
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
  const [pickerDialog, setPickerDialog] = createStore<{ domPickerId: string; tagName: string }>({ domPickerId: "", tagName: "" })
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

  function handleSelectParent() {
    previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_SELECT_PARENT" }, "*")
  }

  function openBothPanels(data: {
    domPickerId: string
    domPickerComponent?: string
    domPickerClass?: string
    elementProps?: string
    tagName?: string
    rawRect?: RawRect | null
  }) {
    openQuickModify(data)
    setPickerDialog({ domPickerId: data.domPickerId, tagName: data.tagName ?? '' })
    setPickerText('')
    setPickerDrag({ x: 0, y: 0 })
    setPickerVisible(true)
    if (ctxMenu.show) {
      setCtxMenu({
        domPickerId: data.domPickerId,
        tagName: data.tagName ?? '',
        domPickerComponent: data.domPickerComponent ?? '',
        domPickerClass: data.domPickerClass ?? '',
        elementProps: data.elementProps ?? '',
        rawRect: data.rawRect ?? null,
      })
    }
  }

  function openQuickModify(data: {
    domPickerId: string
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
      console.log("[preview] open property editor:", { elementId: data.domPickerId, componentType: compType, class: data.domPickerClass, props: data.elementProps })
      setPropertyEditor({
        show: true,
        elementId: data.domPickerId,
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
      const { domPickerId, tagName } = e.data
      setPickerDialog({ domPickerId: domPickerId ?? '', tagName: tagName ?? '' })
      setPickerText('')
      setPickerVisible(true)
      return
    }

    if (e.data?.type === "DOM_PICKER_QUICK_FIX") {
      const { domPickerId, domPickerComponent, domPickerClass, elementProps, tagName, rect } = e.data
      console.log("[preview] DOM_PICKER_QUICK_FIX:", { domPickerId, domPickerComponent, domPickerClass, elementProps, tagName })
      if (annotating()) {
        const r = (rect ?? { top: 0, left: 0, width: 0, height: 0 }) as RawRect
        const paneRect = previewPageRef?.getBoundingClientRect()
        const wrapper = previewIframeRef?.closest('.preview-iframe-wrapper') as HTMLElement | null
        const wrapperRect = wrapper?.getBoundingClientRect()
        const scale = (wrapperRect?.width ?? targetWidth()) / targetWidth()
        setAnnotationPopup({
          show: true,
          rawRect: r,
          target: {
            elementId: domPickerId ?? '',
            elementRect: {
              top: (wrapperRect?.top ?? 0) - (paneRect?.top ?? 0) + r.top * scale,
              left: (wrapperRect?.left ?? 0) - (paneRect?.left ?? 0) + r.left * scale,
              width: r.width * scale,
              height: r.height * scale,
            },
          },
        })
        return
      }
      openBothPanels({
        domPickerId: domPickerId ?? '',
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
        sendDragMode(true, props.pendingData)
      }
    }
    if (e.data?.type === "DRAG_REORDER" && props.onReorder) {
      props.onReorder(e.data.elementId, e.data.targetSiblingId, e.data.position)
    }
  }

  function onClickOutside(e: MouseEvent) {
    if (annotationPopup.show && !(e.target as HTMLElement).closest('.annotation-popup') && !(e.target as HTMLElement).closest('.annotation-badge') && !(e.target as HTMLElement).closest('.annotation-highlight')) {
      handleAnnotationClose()
    }
    if (ctxMenu.show && !(e.target as HTMLElement).closest('.dom-picker-ctx-menu')) {
      closeCtxMenu()
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (annotationPopup.show) { handleAnnotationClose(); return }
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
            setCanvasMode(false)
            sendDragMode(true)
            unfreezeDomPicker()
          } else {
            sendDragMode(false)
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
            previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: true }, "*")
            unfreezeDomPicker()
          } else {
            previewIframeRef?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
            unfreezeDomPicker()
            setAnnotationPopup({ show: false, target: null, rawRect: null })
          }
        }}
      />

      <CanvasView
        ref={(el) => { canvasRef = el }}
        canvasMode={canvasMode()}
        targetWidth={targetWidth()}
        targetHeight={targetHeight()}
        overlay={
          <>
            <Show when={visibleAnnotationData().length > 0}>
              <For each={visibleAnnotationData()}>
                {(item) => (
                  <div
                    class="annotation-badge"
                    style={{
                      top: item.pos.top - 28 + "px",
                      left: item.pos.left + item.pos.width - 14 + "px",
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      openAnnotationFor(item.selector)
                    }}
                    title={item.selector}
                  >
                    <svg viewBox="0 0 24 24" width="28" height="28" class="annotation-badge-icon">
                      <g transform="rotate(45 12 12)">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="#ffffff" stroke="rgba(0,0,0,0.1)" stroke-width="1.5" stroke-linejoin="round" />
                        <circle cx="12" cy="10" r="7" fill="#7B1AFF" />
                      </g>
                      <text x="13.4" y="10.6" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-size="7" font-weight="700" font-family="inherit">
                        用
                      </text>
                    </svg>
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

      <Show when={annotationPopup.show && annotationPopup.target}>
        <AnnotationPopup
          target={annotationPopup.target!}
          author="用户"
          annotations={annotations
            .filter((a) => a.selector === annotationPopup.target!.elementId)
            .map((a): Annotation => ({
              id: a.id,
              elementId: a.selector,
              author: "用户",
              authorInitial: "用",
              text: a.note,
              attachments: a.attachments.map((att) => att.fileName),
              createdAt: a.time,
            }))}
          onSend={handleAnnotationSend}
          onClose={handleAnnotationClose}
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
