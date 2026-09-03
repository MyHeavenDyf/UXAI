import type { PrototypeSession } from "./types"
import { setActiveSessionId, closePrototypePanels } from "./session"
import { dispatchPrototypeCtxMenu, dispatchPrototypeQuickFix, dispatchPrototypeRectUpdate } from "./events"
import { applyPrototypeReorder, writeStateBinding } from "./modify"
import { loadA2uiData, buildSiblingMap, schedulePersistA2ui } from "./a2ui"

/** 构造 prototype iframe 的 message 路由器：把 od:dom-picker-* / od:drag-reorder 等消息
 *  派发给对应 UI 事件 / 改写函数。在派发用户可见事件前置 activeSessionId，保证全局单例面板命中本 session。 */
export function createPrototypeMessageHandler(session: PrototypeSession): (e: MessageEvent) => void {
  return (e: MessageEvent) => {
    // 只处理本 session iframe 发来的消息，避免多个 prototype 标签页 / 孤儿 listener 串扰
    const iframe = session.ctx?.iframeElementGetter?.()
    if (!iframe || e.source !== iframe.contentWindow) return
    const d = e.data
    if (!d || typeof d !== "object") return
    const t = d.type
    if (typeof t !== "string") return
    if (!t.startsWith("od:dom-picker") && t !== "od:drag-reorder" && t !== "od:a2ui-ready" && t !== "A2UI_STATE_CHANGE" && t !== "od:a2ui-state-snapshot") return
    if (t === "A2UI_STATE_CHANGE") {
      // iframe 内交互状态变更（Tabs 切换 / Modal/Drawer 开关 / 滑块等）。
      // 把变更同步进 session.a2ui.doc（内存），这样下次 applyPrototypeModify / commitA2ui
      // 回推 iframe 重渲染时不会丢失用户当前的交互状态（避免 Tab 切回初始页签）。
      // 带 path（数据绑定）→ 写 state；否则（静态字面量）→ 改元素 props。
      const doc = session.a2ui?.doc
      if (!doc || typeof doc !== "object") return
      let mutated = false
      const path = typeof d.path === "string" && d.path ? d.path : ""
      if (path) {
        writeStateBinding((doc as { state?: Record<string, unknown> }).state, path, d.value as string | boolean | number | object)
        mutated = true
      } else if (typeof d.elementId === "string" && typeof d.propName === "string") {
        const elements = (doc as { elements?: Array<{ id: string; props?: Record<string, unknown> }> }).elements
        const baseId = d.elementId.replace(/(:\d+)+$/, "")
        const el = Array.isArray(elements) ? elements.find((x) => x.id === baseId) : undefined
        if (el) {
          el.props = el.props ?? {}
          el.props[d.propName] = d.value
          mutated = true
        }
      }
      // 落盘：A2UI_STATE_CHANGE 之前只改内存 doc 未触发 schedulePersistA2ui，
      // 导致 Tab 切换 / Modal/Drawer 开关在 iframe 刷新或会话关闭后丢失。仅在 editing 态
      // （session.a2ui.doc 由 od:a2ui-ready 加载）下排程写盘，与 applyPrototypeModify 对齐。
      if (mutated && session.editing) {
        const filePath = session.ctx?.tab.filePath || session.ctx?.tab.absoluteFilePath || ""
        if (filePath) schedulePersistA2ui(session, filePath)
      }
      return
    }
    if (t === "od:a2ui-state-snapshot") {
      // iframe 回传当前 surface 运行时 state（用户在非编辑态的交互态：已打开的
      // Modal/Drawer、已切换的 Tab 等）。进入编辑态时父侧 loadA2uiData 从磁盘读到
      // 的 doc.state 是旧值，若不合并就用旧值重建 surface 会让 modal 关闭等。
      // 这里整体替换 doc.state 为 iframe 最新运行时值（snapshot 是 doc.state 的超集，
      // 含用户交互过的修改），再排程落盘。仅 editing 态处理，避免预览态污染。
      if (!session.editing) return
      const doc = session.a2ui?.doc
      const state = d.state
      if (!doc || typeof doc !== "object" || !state || typeof state !== "object") return
      ;(doc as { state?: Record<string, unknown> }).state = state
      const filePath = session.ctx?.tab.filePath || session.ctx?.tab.absoluteFilePath || ""
      if (filePath) schedulePersistA2ui(session, filePath)
      return
    }
    if (t === "od:dom-picker-rect-update") {
      // 选中元素尺寸/位置变化时 iframe ResizeObserver 回传新 rect。做与 quick-fix 相同的
      // iframe→外层坐标缩放后派发 prototype:rect-update，让 PrototypePropertyEditor 的
      // mask 蓝框 + 弹窗位置跟随元素 resize 更新，避免修改后蓝框对不上。
      setActiveSessionId(session.tabId)
      const iframe = session.ctx?.iframeElementGetter?.()
      const rect = iframe?.getBoundingClientRect()
      if (!rect || !iframe || iframe.offsetWidth === 0) return
      const scale = rect.width / iframe.offsetWidth
      const er = d.rect
      if (!er) return
      dispatchPrototypeRectUpdate({
        elementId: String(d.id ?? ""),
        elementRect: {
          top: rect.top + (er.top ?? 0) * scale,
          left: rect.left + (er.left ?? 0) * scale,
          width: (er.width ?? 0) * scale,
          height: (er.height ?? 0) * scale,
        },
      })
      return
    }
    if (t === "od:a2ui-ready") {
      // iframe（重新）加载完成、A2UI 运行时就绪。本 session 处于编辑态时，
      // 重新激活 dom-picker + drag-mode（刷新后 iframe 内运行时已重置），
      // 并清缓存重读 data.js 重建 siblingMap（顺带修刷新后父侧缓存陈旧）。
      if (!session.editing) return
      setActiveSessionId(session.tabId)
      session.ctx?.postMessageToIframe?.({ type: "od:dom-picker-mode", enabled: true })
      session.a2ui = null
      void loadA2uiData(session, session.ctx).then((doc) => {
        session.ctx?.postMessageToIframe?.({ type: "od:drag-mode", enabled: true, siblingMap: buildSiblingMap(doc) })
      })
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
        filePath: session.ctx?.tab.filePath || session.ctx?.tab.absoluteFilePath || "",
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
