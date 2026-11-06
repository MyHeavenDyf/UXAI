/** 评估功能跨组件协调事件（window CustomEvent，模式同 utils/agent-events.ts）。
 *  评估结果面板（result-viewer 层）与 pin 渲染（html-renderer 层）分属不同组件树层级，
 *  经全局事件解耦：面板行点击 → 激活 iframe 内 pin；pin 点击 → 面板联动滚动展开。 */

export const ASSESSMENT_ACTIVATE_PIN_EVENT = "octo:assessment-activate-pin"
export const ASSESSMENT_PIN_ACTIVATED_EVENT = "octo:assessment-pin-activated"

export type AssessmentActivatePinOptions = { openPopup?: boolean }

export function dispatchAssessmentActivatePin(index: number, opts?: AssessmentActivatePinOptions) {
  window.dispatchEvent(new CustomEvent(ASSESSMENT_ACTIVATE_PIN_EVENT, { detail: { index, openPopup: !!opts?.openPopup } }))
}

export function onAssessmentActivatePin(handler: (index: number, opts: AssessmentActivatePinOptions) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ index: number; openPopup?: boolean }>).detail
    handler(detail.index, { openPopup: !!detail.openPopup })
  }
  window.addEventListener(ASSESSMENT_ACTIVATE_PIN_EVENT, listener)
  return () => window.removeEventListener(ASSESSMENT_ACTIVATE_PIN_EVENT, listener)
}

export function dispatchAssessmentPinActivated(index: number) {
  window.dispatchEvent(new CustomEvent(ASSESSMENT_PIN_ACTIVATED_EVENT, { detail: { index } }))
}

export function onAssessmentPinActivated(handler: (index: number) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<{ index: number }>).detail.index)
  window.addEventListener(ASSESSMENT_PIN_ACTIVATED_EVENT, listener)
  return () => window.removeEventListener(ASSESSMENT_PIN_ACTIVATED_EVENT, listener)
}
