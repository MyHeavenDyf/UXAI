import type { SubtypeHandlerContext } from "../../subtype-handlers/types"
import type { AnnotationRecord } from "../../../pattern/utils/annotation-persist"
import { loadAnnotations, saveAnnotations, saveAttachment } from "../../../pattern/utils/annotation-persist"
import { getCommenterInfo, getAvatarUrl } from "../../../pattern/utils/user-info"
import type { RawRect, PrototypeAnnotationPopupTarget, PrototypeAnnotationState } from "./types"

export { getAvatarUrl, getCommenterInfo }

let annotating = false
let annotationCtx: SubtypeHandlerContext | null = null
let annotationMessageHandler: ((e: MessageEvent) => void) | null = null
let annotationRecords: AnnotationRecord[] = []
let annotationPopupTarget: PrototypeAnnotationPopupTarget | null = null

const PROTOTYPE_ANNOTATION_STATE_EVENT = "prototype:annotation-state"

export function isPrototypeAnnotating() {
  return annotating
}

export function dispatchPrototypeAnnotationState() {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_ANNOTATION_STATE_EVENT, {
    detail: { records: annotationRecords, popupTarget: annotationPopupTarget } satisfies PrototypeAnnotationState,
  }))
}

export function onPrototypeAnnotationState(handler: (state: PrototypeAnnotationState) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeAnnotationState>).detail)
  window.addEventListener(PROTOTYPE_ANNOTATION_STATE_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_ANNOTATION_STATE_EVENT, listener)
}

/** UI 层 rAF 循环用:获取当前 prototype iframe 以计算弹窗页面坐标 */
export function getPrototypeAnnotationIframe(): HTMLIFrameElement | undefined {
  return annotationCtx?.iframeElementGetter?.()
}

// ── Pin 渲染(注入 iframe 内部 DOM,与 make 默认标注 comment bridge 同思路) ──

const ANNO_PIN_ATTR = 'data-od-anno-pin'
const ANNO_PIN_BASE_STYLE = 'position:absolute;width:40px;height:40px;background:#fff;border:none;border-radius:999px 999px 999px 0;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483647;box-sizing:border-box;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:transform 0.15s ease;'

/** 在 iframe 内部为每条批注创建/更新/移除 pin(头像)。
 *  pin 用 position:absolute 定位,坐标含 scroll 偏移,天然跟随 iframe 滚动。
 *  每帧由 UI 层 rAF 循环调用。
 *  skipSelector: 弹窗打开时隐藏该 selector 的 pin(避免与弹窗重叠)。
 *  事件处理:pin 的 click/pointerenter 直接调 openPrototypeAnnotationFor(闭包来自父窗口 realm)。 */
export function renderPrototypeAnnotationPins(skipSelector?: string) {
  const iframe = annotationCtx?.iframeElementGetter?.()
  const doc = iframe?.contentDocument
  if (!iframe || !doc) return

  // 按 selector 去重,一个元素只显示一个 pin(取第一条批注的作者)
  const bySelector = new Map<string, { account: string; userName: string }>()
  for (const r of annotationRecords) {
    if (!bySelector.has(r.selector)) bySelector.set(r.selector, { account: r.account, userName: r.userName })
  }

  for (const [selector, info] of bySelector) {
    const el = doc.getElementById(selector)
    let pin = doc.querySelector<HTMLDivElement>(`[${ANNO_PIN_ATTR}="${selector}"]`)

    // 弹窗打开时隐藏该 selector 的 pin;元素不存在也隐藏
    if (selector === skipSelector || !el) {
      if (pin) pin.style.display = 'none'
      continue
    }

    const rect = el.getBoundingClientRect()
    const scrollX = iframe.contentWindow?.scrollX ?? doc.documentElement.scrollLeft ?? 0
    const scrollY = iframe.contentWindow?.scrollY ?? doc.documentElement.scrollTop ?? 0
    const leftPx = rect.left + scrollX + rect.width - 10
    const topPx = rect.top + scrollY - 32

    if (pin) {
      pin.style.display = 'flex'
      pin.style.left = leftPx + 'px'
      pin.style.top = topPx + 'px'
    } else {
      pin = doc.createElement('div')
      pin.setAttribute(ANNO_PIN_ATTR, selector)
      pin.style.cssText = ANNO_PIN_BASE_STYLE
      pin.style.left = leftPx + 'px'
      pin.style.top = topPx + 'px'

      const avatarUrl = getAvatarUrl(info.account)
      if (avatarUrl) {
        pin.innerHTML = '<img src="' + avatarUrl + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;display:block;" />'
      } else {
        const fb = doc.createElement('div')
        fb.style.cssText = 'width:32px;height:32px;border-radius:50%;background:#0a59f7;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:600;'
        fb.textContent = (info.userName || '用户').charAt(0)
        pin.appendChild(fb)
      }

      // 事件处理:闭包捕获父窗口的 openPrototypeAnnotationFor,直接调用(无需 postMessage)
      const sel = selector
      pin.addEventListener('pointerenter', (e) => {
        e.stopPropagation()
        openPrototypeAnnotationFor(sel)
      })
      pin.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        openPrototypeAnnotationFor(sel)
      })

      doc.body.appendChild(pin)
    }
  }

  // 移除已删除批注的 pin
  doc.querySelectorAll(`[${ANNO_PIN_ATTR}]`).forEach((p) => {
    const sel = p.getAttribute(ANNO_PIN_ATTR)!
    if (!bySelector.has(sel)) p.remove()
  })
}

/** 从 iframe 移除所有标注 pin(关闭模式 / 切换 tab 时调用) */
export function clearPrototypeAnnotationPins() {
  const iframe = annotationCtx?.iframeElementGetter?.()
  iframe?.contentDocument?.querySelectorAll(`[${ANNO_PIN_ATTR}]`).forEach(p => p.remove())
}

/** iframe 内原始坐标 → 页面坐标(fixed)。复用 edit quick-fix 同款 scale 换算。 */
export function prototypeRectToPage(rawRect: RawRect): RawRect {
  const iframe = annotationCtx?.iframeElementGetter?.()
  const rect = iframe?.getBoundingClientRect()
  if (!rect || !iframe || iframe.offsetWidth === 0) return { top: 0, left: 0, width: 0, height: 0 }
  const scale = rect.width / iframe.offsetWidth
  return {
    top: rect.top + rawRect.top * scale,
    left: rect.left + rawRect.left * scale,
    width: rawRect.width * scale,
    height: rawRect.height * scale,
  }
}

/** 按元素 ID 实时查询 iframe 内 getBoundingClientRect 并转换为页面坐标(fixed)。
 *  rawRect 是点击时的静态快照，iframe 滚动后失效；
 *  本函数每帧读 contentDocument.getElementById 拿到实时位置，保证弹窗/badge 跟随滚动。
 *  跨域或元素已卸载时回退到静态 rawRect。 */
export function prototypeElementToPage(elementId: string, fallbackRawRect: RawRect): RawRect {
  const iframe = annotationCtx?.iframeElementGetter?.()
  const iframeRect = iframe?.getBoundingClientRect()
  if (!iframeRect || !iframe || iframe.offsetWidth === 0) return prototypeRectToPage(fallbackRawRect)
  try {
    const doc = iframe.contentDocument
    if (!doc) return prototypeRectToPage(fallbackRawRect)
    const el = doc.getElementById(elementId)
    if (!el) return prototypeRectToPage(fallbackRawRect)
    const rect = el.getBoundingClientRect()
    const scale = iframeRect.width / iframe.offsetWidth
    return {
      top: iframeRect.top + rect.top * scale,
      left: iframeRect.left + rect.left * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    }
  } catch {
    return prototypeRectToPage(fallbackRawRect)
  }
}

/** 点击已有 badge 打开弹窗 */
export function openPrototypeAnnotationFor(selector: string) {
  const anno = annotationRecords.find(a => a.selector === selector)
  if (!anno) return
  annotationPopupTarget = { elementId: selector, rawRect: anno.rawRect }
  dispatchPrototypeAnnotationState()
}

/** 关闭弹窗(解冻 picker 以便继续选别的元素) */
export function closePrototypeAnnotationPopup() {
  if (!annotationPopupTarget) return
  annotationPopupTarget = null
  annotationCtx?.postMessageToIframe?.({ type: "DOM_PICKER_UNFREEZE" })
  dispatchPrototypeAnnotationState()
}

/** 发送新批注:保存附件、写入列表、持久化、关闭弹窗解冻 */
export async function applyPrototypeAnnotationSend(text: string, files: File[]) {
  if (!annotationPopupTarget || !annotationCtx) return
  const dir = annotationCtx.sdkDirectory
  const sid = annotationCtx.sessionId ?? annotationCtx.tab.sessionId
  if (!dir || !sid) return

  const id = crypto.randomUUID()
  const attachments: Array<{ fileName: string; id: string }> = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    attachments.push(await saveAttachment(dir, sid, id, file.name, buf))
  }
  const userInfo = getCommenterInfo()
  annotationRecords = [...annotationRecords, {
    id, note: text, selector: annotationPopupTarget.elementId,
    attachments, time: Date.now(),
    account: userInfo.account, userName: userInfo.userName,
    rawRect: annotationPopupTarget.rawRect,
  }]
  await persistPrototypeAnnotations()
  annotationPopupTarget = null
  annotationCtx.postMessageToIframe?.({ type: "DOM_PICKER_UNFREEZE" })
  dispatchPrototypeAnnotationState()
}

/** 删除当前弹窗指向元素的所有批注 */
export async function applyPrototypeAnnotationDelete() {
  const selector = annotationPopupTarget?.elementId
  if (!selector || !annotationCtx) return
  annotationRecords = annotationRecords.filter(a => a.selector !== selector)
  annotationPopupTarget = null
  await persistPrototypeAnnotations()
  annotationCtx.postMessageToIframe?.({ type: "DOM_PICKER_UNFREEZE" })
  dispatchPrototypeAnnotationState()
}

/** 编辑已有批注:追加附件、更新文本/时间,保留原作者归属 */
export async function applyPrototypeAnnotationEdit(id: string, text: string, files: File[]) {
  if (!annotationCtx) return
  const dir = annotationCtx.sdkDirectory
  const sid = annotationCtx.sessionId ?? annotationCtx.tab.sessionId
  if (!dir || !sid) return
  const newAttachments: Array<{ fileName: string; id: string }> = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    newAttachments.push(await saveAttachment(dir, sid, id, file.name, buf))
  }
  const userInfo = getCommenterInfo()
  annotationRecords = annotationRecords.map(a =>
    a.id !== id ? a : {
      ...a, note: text, attachments: [...a.attachments, ...newAttachments], time: Date.now(),
      account: a.account || userInfo.account, userName: a.userName || userInfo.userName,
    },
  )
  await persistPrototypeAnnotations()
  dispatchPrototypeAnnotationState()
}

async function persistPrototypeAnnotations() {
  const dir = annotationCtx?.sdkDirectory
  const sid = annotationCtx?.sessionId ?? annotationCtx?.tab?.sessionId
  if (!dir || !sid) return
  await saveAnnotations(dir, sid, annotationRecords)
}

async function loadPrototypeAnnotations() {
  const dir = annotationCtx?.sdkDirectory
  const sid = annotationCtx?.sessionId ?? annotationCtx?.tab?.sessionId
  if (!dir || !sid) return
  annotationRecords = await loadAnnotations(dir, sid)
  dispatchPrototypeAnnotationState()
}

/** 挂载 DOM_PICKER_* 消息监听:单击元素 toggle 弹窗、CLOSE_PANELS 关闭 */
function createAnnotationMessageHandler(): (e: MessageEvent) => void {
  return (e: MessageEvent) => {
    const iframe = annotationCtx?.iframeElementGetter?.()
    if (!iframe || e.source !== iframe.contentWindow) return
    const d = e.data
    if (!d || typeof d !== "object") return
    const t = d.type
    if (typeof t !== "string") return

    if (t === "DOM_PICKER_QUICK_FIX") {
      if (annotationPopupTarget) {
        closePrototypeAnnotationPopup()
        return
      }
      const elementId = String(d.id ?? "")
      if (!elementId) return
      const rawRect = (d.rect ?? { top: 0, left: 0, width: 0, height: 0 }) as RawRect
      annotationPopupTarget = { elementId, rawRect }
      dispatchPrototypeAnnotationState()
      return
    }

    if (t === "DOM_PICKER_CLOSE_PANELS") {
      closePrototypeAnnotationPopup()
    }
  }
}

/** 开启标注模式:解冻旧 session、挂 handler、发 DOM_PICKER_TOGGLE active、加载已有批注 */
export function startAnnotation(ctx: SubtypeHandlerContext) {
  annotating = true
  annotationCtx = ctx

  if (!annotationMessageHandler) {
    annotationMessageHandler = createAnnotationMessageHandler()
    window.addEventListener("message", annotationMessageHandler)
  }

  ctx.postMessageToIframe?.({ type: "DOM_PICKER_TOGGLE", active: true })
  void loadPrototypeAnnotations()
}

/** 关闭标注模式:发 DOM_PICKER_TOGGLE inactive */
export function stopAnnotation(ctx: SubtypeHandlerContext) {
  ctx.postMessageToIframe?.({ type: "DOM_PICKER_TOGGLE", active: false })
}

/** 清除全部标注状态(切换 tab / 关闭模式时调用) */
export function resetPrototypeAnnotation() {
  clearPrototypeAnnotationPins()
  annotating = false
  annotationCtx = null
  annotationPopupTarget = null
  annotationRecords = []
  if (annotationMessageHandler) {
    window.removeEventListener("message", annotationMessageHandler)
    annotationMessageHandler = null
  }
  dispatchPrototypeAnnotationState()
}
