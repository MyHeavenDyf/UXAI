import { createSignal, createMemo, Show, onCleanup, createEffect } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { AnnotationPopup, type Annotation } from "@/pages/pattern/modules/preview/annotation-popup"
import type { AnnotationRecord } from "@/pages/pattern/utils/annotation-persist"
import "@/pages/pattern/assets/style/preview/annotation.css"
import {
  onPrototypeAnnotationState,
  getPrototypeAnnotationIframe,
  prototypeElementToPage,
  renderPrototypeAnnotationPins,
  clearPrototypeAnnotationPins,
  openPrototypeAnnotationFor,
  closePrototypeAnnotationPopup,
  applyPrototypeAnnotationSend,
  applyPrototypeAnnotationDelete,
  applyPrototypeAnnotationEdit,
  getAvatarUrl,
  getCommenterInfo,
} from "../../utils/prototype-utils"

type RawRect = { top: number; left: number; width: number; height: number }

export function PrototypeAnnotationLayer(): JSX.Element {
  const [records, setRecords] = createSignal<AnnotationRecord[]>([])
  const [popupTarget, setPopupTarget] = createSignal<{ elementId: string; rawRect: RawRect } | null>(null)
  const [popupRect, setPopupRect] = createSignal({ top: 0, left: 0, width: 0, height: 0 })

  const unsub = onPrototypeAnnotationState((state) => {
    setRecords(state.records)
    setPopupTarget(state.popupTarget)
  })
  onCleanup(unsub)

  let rafId: number | null = null

  createEffect(() => {
    const shouldRun = records().length > 0 || popupTarget() !== null
    if (shouldRun && rafId === null) {
      const loop = () => {
        rafId = requestAnimationFrame(loop)
        updateFrame()
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
    clearPrototypeAnnotationPins()
  })

  /** 每帧:① 更新 iframe 内 pin 位置 ② 更新父窗口弹窗的页面坐标 */
  function updateFrame() {
    const popupSel = popupTarget()?.elementId
    // pin 在 iframe 内部,rAF 更新位置跟随滚动
    renderPrototypeAnnotationPins(popupSel)
    // 弹窗在父窗口,需 iframe 内坐标 → 页面坐标
    const pt = popupTarget()
    if (pt) setPopupRect(prototypeElementToPage(pt.elementId, pt.rawRect))
  }

  const onClickOutside = (e: MouseEvent) => {
    if (!popupTarget()) return
    const el = e.target as HTMLElement
    // pin 在 iframe 内,外部点击检测排除 popup/highlight 即可
    if (!el.closest('.annotation-popup') && !el.closest('.annotation-highlight')) {
      closePrototypeAnnotationPopup()
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && popupTarget()) closePrototypeAnnotationPopup()
  }
  window.addEventListener('click', onClickOutside)
  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => {
    window.removeEventListener('click', onClickOutside)
    window.removeEventListener('keydown', onKeyDown)
  })

  const popupAnnotations = createMemo<Annotation[]>(() => {
    const sel = popupTarget()?.elementId
    if (!sel) return []
    return records().filter(r => r.selector === sel).map(r => ({
      id: r.id,
      elementId: r.selector,
      author: r.userName || "用户",
      authorInitial: (r.userName || "用户").charAt(0),
      avatar: getAvatarUrl(r.account),
      text: r.note,
      attachments: r.attachments.map(a => a.fileName),
      createdAt: r.time,
    }))
  })

  return (
    <Portal mount={document.body}>
      <div style={{ position: "fixed", inset: "0", "pointer-events": "none", "z-index": "9999" }}>
        <Show when={popupTarget()}>
          <AnnotationPopup
            target={{ elementId: popupTarget()!.elementId, elementRect: popupRect() }}
            author={getCommenterInfo().userName}
            authorAvatar={getCommenterInfo().avatar}
            annotations={popupAnnotations()}
            onSend={applyPrototypeAnnotationSend}
            onClose={closePrototypeAnnotationPopup}
            onDelete={applyPrototypeAnnotationDelete}
            onEdit={applyPrototypeAnnotationEdit}
          />
        </Show>
      </div>
    </Portal>
  )
}
