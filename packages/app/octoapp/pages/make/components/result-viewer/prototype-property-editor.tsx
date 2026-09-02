import { createSignal, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { JSX } from "solid-js"
import { PropertyEditorPopup } from "@/pages/pattern/modules/preview/property-editor-popup"
import type { ModifyElementData } from "@/pages/pattern/modules/preview/property-editor-popup/types"
import "@/pages/pattern/assets/style/preview/PropertyEditorPopup.css"
import {
  onPrototypeQuickFix,
  onPrototypeClosePanels,
  onPrototypeRectUpdate,
  closePrototypePanels,
  applyPrototypeModify,
  dispatchPrototypePickerSubmit,
  dispatchPrototypePickerAppend,
  type PrototypeQuickFixData,
} from "../../utils/prototype-utils"

export function PrototypePropertyEditor(): JSX.Element {
  const [data, setData] = createSignal<PrototypeQuickFixData | null>(null)
  const [pickerText, setPickerText] = createSignal("")
  const [pickerVisible, setPickerVisible] = createSignal(false)
  const [pickerDrag, setPickerDrag] = createStore({ x: 0, y: 0 })

  const closeUi = () => setData(null)
  const closePicker = () => setPickerVisible(false)
  const closeAll = () => {
    closeUi()
    closePicker()
    closePrototypePanels()
  }

  const unsubQuickFix = onPrototypeQuickFix((d) => {
    setData(d)
    setPickerText("")
    setPickerDrag({ x: 0, y: 0 })
    setPickerVisible(true)
  })
  // 选中元素在编辑过程中尺寸/位置变化（如改 className/文本导致换行/宽度变化）时，
  // iframe ResizeObserver 会经 message-handler 派发 prototype:rect-update。这里按
  // elementId 匹配当前选中的元素，更新 elementRect，让 mask 蓝框和编辑器弹窗跟随。
  const unsubRectUpdate = onPrototypeRectUpdate((d) => {
    const cur = data()
    if (cur && cur.elementId === d.elementId) {
      setData({ ...cur, elementRect: d.elementRect })
    }
  })
  const unsubClose = onPrototypeClosePanels(() => { closeUi(); closePicker() })
  onCleanup(() => { unsubQuickFix(); unsubRectUpdate(); unsubClose() })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeAll()
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  function submitPicker() {
    const d = data()
    const text = pickerText().trim()
    dispatchPrototypePickerSubmit({ text, id: d?.elementId ?? "" })
    closeAll()
  }

  function appendPickerNext() {
    const d = data()
    const text = pickerText().trim()
    if (!text) return
    dispatchPrototypePickerAppend({ text, id: d?.elementId ?? "" })
    setPickerText("")
    closeAll()
  }

  function startPickerDrag(e: MouseEvent) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const ox = pickerDrag.x, oy = pickerDrag.y
    const onMove = (me: MouseEvent) => setPickerDrag({ x: ox + (me.clientX - sx), y: oy + (me.clientY - sy) })
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function containerRect() {
    const el = document.querySelector(".make-right-panel") as HTMLElement | null
    if (el) return el.getBoundingClientRect()
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, right: window.innerWidth, bottom: window.innerHeight }
  }

  const hasRect = createMemo(() => {
    const r = data()?.elementRect
    return !!r && r.width > 0 && r.height > 0
  })

  const dialogStyle = createMemo((): JSX.CSSProperties => {
    const r = data()?.elementRect
    const drag = `translate(${pickerDrag.x}px, ${pickerDrag.y}px)`
    if (!r || r.width <= 0 || r.height <= 0) {
      return { position: "fixed", left: "50%", bottom: "10%", transform: `translateX(-50%) ${drag}` }
    }
    const c = containerRect()
    const el = r.left - c.left
    const et = r.top - c.top
    const gap = 8, dw = 400, estH = 220
    let left = Math.max(8, Math.min(el + (r.width - dw) / 2, c.width - 8 - dw))
    const naturalTop = et + r.height + gap
    const aboveTop = et - estH - gap
    const top = naturalTop + estH > c.height - 8 ? (aboveTop > 8 ? aboveTop : 8) : naturalTop
    return { position: "fixed", left: `${left}px`, top: `${top}px`, transform: drag }
  })

  const maskStyle = createMemo((): JSX.CSSProperties => {
    const r = data()?.elementRect
    if (!r) return {}
    const c = containerRect()
    return {
      position: "fixed",
      left: `${r.left - c.left}px`, top: `${r.top - c.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      "z-index": "50", "pointer-events": "none",
      "box-shadow": "0 0 0 9999px rgba(0,0,0,0.3)",
      border: "2px solid #007bff", background: "rgba(0,123,255,0.1)", "box-sizing": "border-box",
    }
  })

  return (
    <>
      <Show when={pickerVisible() || data()}>
        <div onClick={closeAll} style={{ position: "fixed", inset: "0", "z-index": "49", background: "transparent" }} />
        <Show when={hasRect()}>
          <div style={maskStyle()} />
        </Show>
      </Show>

      <Show when={data()}>
        {(d) => (
          <PropertyEditorPopup
            show={true}
            elementId={d().elementId}
            componentType={d().componentType}
            currentClass={d().currentClass}
            elementProps={d().elementProps}
            htmlFilePath={d().filePath}
            elementRect={d().elementRect}
            containerSize={{ width: window.innerWidth, height: window.innerHeight }}
            onConfirm={(mod: ModifyElementData) => {
              applyPrototypeModify(mod)
              if (!mod.keepOpen) closeAll()
            }}
            onCancel={closeAll}
          />
        )}
      </Show>

      <Show when={pickerVisible()}>
        <div
          style={{
            ...dialogStyle(),
            "z-index": "100",
            width: "400px",
            "max-width": "90vw",
            "box-sizing": "border-box",
            background: "#F9F9F9",
            "border-radius": "12px",
            "box-shadow": "0 4px 24px rgba(0,0,0,0.15)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            onMouseDown={startPickerDrag}
            style={{ padding: "16px 20px", "font-size": "14px", "font-weight": "600", color: "#1f2937", cursor: "grab", "user-select": "none" }}
          >
            修改选中区域
          </div>
          <div style={{ padding: "0 16px 16px" }}>
            <textarea
              value={pickerText()}
              onInput={(e) => setPickerText(e.currentTarget.value)}
              placeholder="描述你想要的修改..."
              rows={2}
              style={{
                width: "100%", height: "110px", resize: "none",
                "background-color": "#FFF", "border-radius": "8px",
                border: "1px solid rgba(0,0,0,0.1)", "box-sizing": "border-box",
                padding: "8px 12px", outline: "none",
              }}
            />
            <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "12px" }}>
              <button type="button" onClick={closeAll} style={{ width: "98px", height: "32px", "border-radius": "9999px", border: "1px solid rgba(0,0,0,0.15)", background: "transparent", cursor: "pointer" }}>
                取消
              </button>
              <button type="button" onClick={appendPickerNext} style={{ width: "98px", height: "32px", "border-radius": "9999px", background: "rgb(10,89,247)", color: "#fff", border: "none", cursor: "pointer" }}>
                下一项
              </button>
              <button type="button" onClick={submitPicker} style={{ width: "98px", height: "32px", "border-radius": "9999px", background: "rgb(10,89,247)", color: "#fff", border: "none", cursor: "pointer" }}>
                确认
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
