import type { PrototypeSession } from "./types"
import { setActiveSessionId, closePrototypePanels } from "./session"
import { dispatchPrototypeCtxMenu, dispatchPrototypeQuickFix } from "./events"
import { applyPrototypeReorder } from "./modify"

/** 构造 prototype iframe 的 message 路由器：把 od:dom-picker-* / od:drag-reorder 等消息
 *  派发给对应 UI 事件 / 改写函数。在派发用户可见事件前置 activeSessionId，保证全局单例面板命中本 session。 */
export function createPrototypeMessageHandler(session: PrototypeSession): (e: MessageEvent) => void {
  return (e: MessageEvent) => {
    const d = e.data
    if (!d || typeof d !== "object") return
    const t = d.type
    if (typeof t !== "string") return
    if (!t.startsWith("od:dom-picker") && t !== "od:drag-reorder" && t !== "od:a2ui-ready") return
    if (t === "od:dom-picker-rect-update") {
      // TODO: 把新 rect 回推到 PrototypePropertyEditor 让弹层跟随元素 resize，
      // 当前先静默忽略以去除 console 噪声。
      return
    }
    if (t === "od:dom-picker-context-menu") {
      setActiveSessionId(session.tabId)
      const iframe = session.ctx?.iframeElementGetter?.()
      const rect = iframe?.getBoundingClientRect()
      // iframe 隐藏（offsetWidth=0）时坐标换算无意义，直接放弃，避免菜单飞到屏幕外。
      if (!rect || !iframe || iframe.offsetWidth === 0) return
      const scale = rect.width / iframe.offsetWidth
      dispatchPrototypeCtxMenu({
        x: rect.left + (d.clickX ?? 0) * scale,
        y: rect.top + (d.clickY ?? 0) * scale,
        id: String(d.id ?? ""),
        tagName: String(d.tagName ?? ""),
      })
      return
    }
    if (t === "od:dom-picker-quick-fix") {
      setActiveSessionId(session.tabId)
      const iframe = session.ctx?.iframeElementGetter?.()
      const rect = iframe?.getBoundingClientRect()
      if (!rect || !iframe || iframe.offsetWidth === 0) return
      const scale = rect.width / iframe.offsetWidth
      const er = d.rect
      dispatchPrototypeQuickFix({
        elementId: String(d.id ?? ""),
        componentType: String(d.domPickerComponent || d.tagName || ""),
        currentClass: String(d.domPickerClass ?? ""),
        elementProps: String(d.elementProps ?? ""),
        elementRect: er ? {
          top: rect.top + (er?.top ?? 0) * scale,
          left: rect.left + (er?.left ?? 0) * scale,
          width: (er?.width ?? 0) * scale,
          height: (er?.height ?? 0) * scale,
        } : { top: 0, left: 0, width: 0, height: 0 },
      })
      return
    }
    if (t === "od:dom-picker-close-panels") {
      setActiveSessionId(session.tabId)
      closePrototypePanels()
      return
    }
    if (t === "od:drag-reorder") {
      setActiveSessionId(session.tabId)
      applyPrototypeReorder(
        String(d.elementId ?? ""),
        String(d.targetSiblingId ?? ""),
        d.position === "after" ? "after" : "before",
      )
      return
    }
    console.log("[prototype] iframe message:", t, d)
  }
}
